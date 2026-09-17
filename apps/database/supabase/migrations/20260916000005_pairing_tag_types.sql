------------------------------------------------------------------------------
-- A pairing's tags carry their TYPE
--
-- `RecipeCard`'s eyebrow — "ITALIAN · PASTA", the line above the dish's name on
-- every horizontal card in the app — is derived entirely from `tag.type`:
-- `groupRecipeTags` looks for a `cuisine` and for a `dish_form`/`component`/
-- intrinsic-`course` tag, and finds neither without it. Both pairing RPCs
-- aggregated their tags as `{id, name}`, so every card the compose picker and
-- the composer drew from a pairing was the one kind of horizontal card in the
-- app with no eyebrow at all — silently, because an absent eyebrow is also what
-- a dish with genuinely no tags looks like.
--
-- Additive in the only sense that matters: a caller that ignores the key is
-- unaffected, and the two surfaces that render these as cards start drawing the
-- line every other surface already draws.
--
-- **Both functions are replaced whole**, which is what `create or replace`
-- requires, and neither SIGNATURE changes — the key goes inside the `tags`
-- jsonb the return type already declares. So there is no `drop function` here
-- and no arity to assert exactly one of.
--
-- **`menu_pairings_for_recipe` is taken from `20260822000003`, not from the
-- migration that introduced it.** `20260822000001`'s copy is stale: it calls
-- `menu_is_publishable(owner_profile_id, course_count)`, a signature that
-- changed a migration later, so replaying it fails outright with
-- "function menu_is_publishable(uuid, integer) does not exist". Anything that
-- copies a function body forward has to take the LAST definition — which this
-- one now is, and the next one has to remember in turn.
------------------------------------------------------------------------------

-- menu_pairings_for_recipe (from 20260822000003_publishable_requires_recipes.sql): 2 tag aggregations, each gaining 'type'.
create or replace function public.menu_pairings_for_recipe(
    p_recipe_id     uuid,
    p_course_types  text[],
    p_per_course    integer default 3,
    p_exclude_names text[] default '{}'::text[],
    p_exclude_keys  uuid[] default '{}'::uuid[],
    p_blacklist     uuid[] default '{}'::uuid[],
    p_dietary       text[] default '{}'::text[],
    p_difficulty    text default null
)
    returns table
            (
                course_type        text,
                pair_rank          integer,
                dish_key           uuid,
                is_recipe          boolean,
                dish_id            uuid,
                name               text,
                name_en            text,
                description        text,
                short_description  text,
                difficulty         text,
                total_time_minutes integer,
                image              text,
                ingredients        jsonb,
                tags               jsonb,
                menu_ids           uuid[],
                pair_saves         integer
            )
    language sql
    stable
as
$function$
with wanted as (select distinct lower(btrim(c)) as course_type
                from unnest(p_course_types) c
                where btrim(c) <> ''),

     excluded as (select distinct lower(btrim(n)) as name
                  from unnest(p_exclude_names) n
                  where btrim(n) <> ''),

     diets as (select distinct t.id                              as tag_id,
                               t.canonical_id,
                               (dr.diet_canonical_id is not null) as is_derived
               from unnest(p_dietary) d
                        join tags t
                             on t.type = 'dietary'
                                 and lower(btrim(t.name)) = lower(btrim(d))
                        left join dietary_rules dr on dr.diet_canonical_id = t.canonical_id
               where btrim(d) <> ''),

     diet_tags as (select s.root_id, s.tag_id
                   from tag_subtree(array(select tag_id from diets where not is_derived)) s),

     target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key),

     source_menu as (select m.id,
                            m.saved_count,
                            (m.main_recipe_id = p_recipe_id) as built_around
                     from menus m
                     where menu_is_publishable(m.id, m.owner_profile_id, m.course_count)
                       and exists (select 1
                                   from menu_courses mc,
                                        target t
                                   where mc.menu_id = m.id
                                     and mc.dish_key = t.dish_key)),

     partner as (select mc.dish_key                  as course_key,
                        lower(btrim(mc.course_type)) as course_type,
                        sm.id                        as menu_id,
                        sm.saved_count,
                        sm.built_around
                 from source_menu sm
                          join menu_courses mc on mc.menu_id = sm.id
                          join wanted w on w.course_type = lower(btrim(mc.course_type))
                          cross join target t
                 where mc.dish_key <> t.dish_key
                   and not (mc.dish_key = any (p_exclude_keys))),

     dish as (select k.course_key,
                     fam.id                   as recipe_id,
                     fam.source_suggestion_id as recipe_dish_key,
                     s.id                     as suggestion_id
              from (select distinct course_key from partner) k
                       left join lateral (
                  select b.id, b.source_suggestion_id
                  from recipes r
                           join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                  where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                    and b.created_by is null
                  order by (r.id = k.course_key) desc, b.id
                  limit 1) fam on true
                       left join recipe_suggestions s
                                 on fam.id is null and s.id = k.course_key),

     candidate as (select d.course_key,
                          (d.recipe_id is not null)                                 as is_recipe,
                          coalesce(d.recipe_id, d.suggestion_id)                    as dish_id,
                          coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                          coalesce(r.name, s.name)                                  as name,
                          coalesce(r.name_en, s.name_en)                            as name_en,
                          coalesce(r.description, s.description)                    as description,
                          r.short_description,
                          coalesce(r.difficulty, s.difficulty)::text                as difficulty,
                          coalesce(r.total_time_minutes, s.total_time_minutes)      as total_time_minutes,
                          r.image
                   from dish d
                            left join recipes r on r.id = d.recipe_id
                            left join recipe_suggestions s on s.id = d.suggestion_id
                   where coalesce(d.recipe_id, d.suggestion_id) is not null),

     keep as (select c.*
              from candidate c
              where not exists (select 1
                                from excluded e
                                where e.name in (lower(btrim(c.name)),
                                                 lower(btrim(coalesce(c.name_en, '')))))

                and (coalesce(array_length(p_blacklist, 1), 0) = 0
                  or (c.is_recipe and not exists (select 1
                                                  from recipe_ingredients ri
                                                  where ri.recipe_id = c.dish_id
                                                    and ri.ingredient_id = any (p_blacklist)))
                  or (not c.is_recipe and not exists (select 1
                                                      from recipe_suggestion_ingredients rsi
                                                      where rsi.recipe_suggestion_id = c.dish_id
                                                        and rsi.ingredient_id = any (p_blacklist))))

                and not exists (select 1
                                from diets dt
                                where not (case
                                               when dt.is_derived
                                                   then (c.is_recipe and exists (select 1
                                                                                 from recipe_dietary rd
                                                                                 where rd.recipe_id = c.dish_id
                                                                                   and rd.diet_canonical_id = dt.canonical_id))
                                                       or (not c.is_recipe and exists (select 1
                                                                                       from recipe_suggestion_dietary rsd
                                                                                       where rsd.recipe_suggestion_id = c.dish_id
                                                                                         and rsd.diet_canonical_id = dt.canonical_id))
                                               else (c.is_recipe and exists (select 1
                                                                             from diet_tags s
                                                                                      join recipe_tags rt
                                                                                           on rt.recipe_id = c.dish_id
                                                                                               and rt.tag_id = s.tag_id
                                                                             where s.root_id = dt.tag_id))
                                                   or (not c.is_recipe and exists (select 1
                                                                                   from diet_tags s
                                                                                            join recipe_suggestion_tags rst
                                                                                                 on rst.recipe_suggestion_id = c.dish_id
                                                                                                     and rst.tag_id = s.tag_id
                                                                                   where s.root_id = dt.tag_id))
                    end))),

     ranked as (select p.course_type,
                       k.dish_key,
                       k.is_recipe,
                       k.dish_id,
                       k.name,
                       k.name_en,
                       k.description,
                       k.short_description,
                       k.difficulty,
                       k.total_time_minutes,
                       k.image,
                       array_agg(distinct p.menu_id) as menu_ids,
                       sum(p.saved_count)::integer   as pair_saves,
                       row_number() over (
                           partition by p.course_type
                           order by bool_or(p.built_around) desc,
                                    sum(p.saved_count) desc,
                                    count(distinct p.menu_id) desc,
                                    difficulty_preference_rank(k.difficulty, p_difficulty),
                                    k.name
                           )::integer                as pair_rank
                from keep k
                         join partner p on p.course_key = k.course_key
                group by p.course_type, k.dish_key, k.is_recipe, k.dish_id, k.name,
                         k.name_en, k.description, k.short_description, k.difficulty,
                         k.total_time_minutes, k.image)

select rk.course_type,
       rk.pair_rank,
       rk.dish_key,
       rk.is_recipe,
       rk.dish_id,
       rk.name,
       rk.name_en,
       coalesce(rk.description, ''),
       rk.short_description,
       rk.difficulty,
       rk.total_time_minutes,
       rk.image,
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                     from recipe_ingredients ri
                              join ingredients i on i.id = ri.ingredient_id
                     where ri.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                 from recipe_suggestion_ingredients rsi
                          join ingredients i on i.id = rsi.ingredient_id
                 where rsi.recipe_suggestion_id = rk.dish_id) end,
       case
           when rk.is_recipe
               then (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                     from recipe_tags rt
                              join tags t on t.id = rt.tag_id
                     where rt.recipe_id = rk.dish_id)
           else (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                 from recipe_suggestion_tags rst
                          join tags t on t.id = rst.tag_id
                 where rst.recipe_suggestion_id = rk.dish_id) end,
       rk.menu_ids,
       rk.pair_saves
from ranked rk
where rk.pair_rank <= greatest(p_per_course, 1);
$function$;

-- pairing_candidates_for_recipe (from 20260916000001_dish_pairings.sql): 4 tag aggregations, each gaining 'type'.
create or replace function public.pairing_candidates_for_recipe(
    p_recipe_id    uuid,
    p_course_types text[],
    p_per_course   integer default 6,
    p_blacklist    uuid[] default '{}'::uuid[],
    p_dietary      text[] default '{}'::text[],
    p_difficulty   text default null,
    -- Dishes the caller has ALREADY CHOSEN, as
    -- `[{"course_type": "...", "dish_id": "..."}]`.
    --
    -- Resolved and returned whatever the pairing layer thinks of them, because
    -- the reader chose them — typically through the picker's unscoped search,
    -- which by construction offers dishes no pairing named. Without this the
    -- composer cannot see its own pick: `offeredFor` finds no match, falls back
    -- to the proposals, and either puts a DIFFERENT dish on the menu or counts
    -- the slot unfilled and pays the model to write one.
    --
    -- It resolves here rather than in a second client query so the answer
    -- arrives with the rest — the compose enqueue is gated on one readiness
    -- flag, and a pick that resolved later would change `generatedCounts` and
    -- mint a second paid job id.
    p_include      jsonb default '[]'::jsonb
)
    returns table
            (
                course_type        text,
                source             text,
                pair_rank          integer,
                dish_key           uuid,
                is_recipe          boolean,
                dish_id            uuid,
                name               text,
                name_en            text,
                description        text,
                short_description  text,
                difficulty         text,
                total_time_minutes integer,
                image              text,
                ingredients        jsonb,
                tags               jsonb
            )
    language sql
    stable
    security definer
    set search_path = public, pg_temp
as
$function$
with wanted as (select distinct lower(btrim(c)) as course_type
                from unnest(coalesce(p_course_types, '{}'::text[])) c
                where btrim(c) <> ''),

     -- The dish being composed around, normalised the same way every other menu
     -- read normalises it.
     target as (select coalesce(
                               (select coalesce(r.source_suggestion_id, r.id)
                                from recipes r
                                where r.id = p_recipe_id),
                               p_recipe_id) as dish_key),

     -- Layer 1. Asked for GENEROUSLY and cut per course at the very end,
     -- because the two layers are deduped against each other in between — a
     -- dish that is both evidence and a proposal must take a slot once, as
     -- evidence.
     --
     -- The `+ 2` is the same slack `fetchMenuPairings` asks for in compose and
     -- for the same reason: this inner cut happens per course, BEFORE the
     -- cross-course dedup drops a dish that appears in two of them. Cut to
     -- exactly `p_per_course` here and a course can come back short of dishes
     -- the corpus was holding — which the reader would see as a thin pairing
     -- layer rather than as a cut, and which the floor in the picker would then
     -- apologise for.
     evidence as (select mp.course_type,
                         'menu'::text as source,
                         mp.pair_rank,
                         mp.dish_key,
                         mp.is_recipe,
                         mp.dish_id,
                         mp.name,
                         mp.name_en,
                         mp.description,
                         mp.short_description,
                         mp.difficulty,
                         mp.total_time_minutes,
                         mp.image,
                         mp.ingredients,
                         mp.tags
                  from menu_pairings_for_recipe(
                               p_recipe_id,
                               array(select course_type from wanted),
                               greatest(p_per_course, 1) + 2,
                               '{}'::text[],
                               '{}'::uuid[],
                               coalesce(p_blacklist, '{}'::uuid[]),
                               coalesce(p_dietary, '{}'::text[]),
                               p_difficulty
                       ) mp),

     -- Layer 2. Resolved exactly as `menu_pairings_for_recipe` resolves a
     -- course key: a recipe in the shared catalogue if the dish has been
     -- promoted, otherwise the suggestion row. `b.created_by is null` keeps a
     -- private import out of everybody's proposals.
     proposal_key as (select dp.course_type,
                             dp.dish_key as course_key,
                             dp.rank
                      from dish_pairings dp
                               join wanted w on w.course_type = lower(btrim(dp.course_type))
                               cross join target t
                      where dp.main_dish_key = t.dish_key
                        and dp.dish_key <> t.dish_key),

     proposal_dish as (select k.course_type,
                              k.course_key,
                              k.rank,
                              fam.id                   as recipe_id,
                              fam.source_suggestion_id as recipe_dish_key,
                              s.id                     as suggestion_id
                       from proposal_key k
                                left join lateral (
                           select b.id, b.source_suggestion_id
                           from recipes r
                                    join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                           where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                             and b.created_by is null
                           order by (r.id = k.course_key) desc, b.id
                           limit 1) fam on true
                                left join recipe_suggestions s
                                          on fam.id is null and s.id = k.course_key),

     proposal as (select d.course_type,
                         'proposed'::text                                         as source,
                         d.rank                                                   as pair_rank,
                         coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                         (d.recipe_id is not null)                                as is_recipe,
                         coalesce(d.recipe_id, d.suggestion_id)                   as dish_id,
                         coalesce(r.name, s.name)                                 as name,
                         coalesce(r.name_en, s.name_en)                           as name_en,
                         coalesce(r.description, s.description, '')               as description,
                         r.short_description,
                         coalesce(r.difficulty, s.difficulty)::text               as difficulty,
                         coalesce(r.total_time_minutes, s.total_time_minutes)     as total_time_minutes,
                         r.image
                  from proposal_dish d
                           left join recipes r on r.id = d.recipe_id
                           left join recipe_suggestions s on s.id = d.suggestion_id
                  where coalesce(d.recipe_id, d.suggestion_id) is not null
                    -- The read-time half of the "constraints filter, they do not
                    -- generate" rule. A shared set is written without knowing
                    -- who will read it, so this is the only place the reader's
                    -- own diet can be honoured.
                    and dish_meets_constraints(
                            coalesce(d.recipe_id, d.suggestion_id),
                            d.recipe_id is not null,
                            coalesce(p_blacklist, '{}'::uuid[]),
                            coalesce(p_dietary, '{}'::text[]))),

     -- The reader's own picks, resolved exactly as a proposal is.
     include_key as (select lower(btrim(e.course_type)) as course_type,
                            e.dish_id                   as course_key
                     from jsonb_to_recordset(coalesce(p_include, '[]'::jsonb))
                              as e(course_type text, dish_id uuid)
                              join wanted w on w.course_type = lower(btrim(e.course_type))
                              cross join target t
                     where e.dish_id is not null
                       and e.dish_id <> t.dish_key),

     include_dish as (select k.course_type,
                             k.course_key,
                             fam.id                   as recipe_id,
                             fam.source_suggestion_id as recipe_dish_key,
                             s.id                     as suggestion_id
                      from include_key k
                               left join lateral (
                          select b.id, b.source_suggestion_id
                          from recipes r
                                   join recipes b on b.id = coalesce(r.base_recipe_id, r.id)
                          where (r.id = k.course_key or r.source_suggestion_id = k.course_key)
                            and b.created_by is null
                          order by (r.id = k.course_key) desc, b.id
                          limit 1) fam on true
                               left join recipe_suggestions s
                                         on fam.id is null and s.id = k.course_key),

     -- NOT filtered by `dish_meets_constraints`, unlike a proposal, and that is
     -- deliberate: the reader picked this dish. The picker's search already
     -- applies their blacklist, so one reaching here is one they chose in full
     -- knowledge — and dropping it would substitute a dish they did not choose,
     -- which is the failure the parameter exists to end rather than a filter to
     -- enforce.
     included as (select d.course_type,
                         'chosen'::text                                           as source,
                         0                                                        as pair_rank,
                         coalesce(d.recipe_dish_key, d.recipe_id, d.suggestion_id) as dish_key,
                         (d.recipe_id is not null)                                as is_recipe,
                         coalesce(d.recipe_id, d.suggestion_id)                   as dish_id,
                         coalesce(r.name, s.name)                                 as name,
                         coalesce(r.name_en, s.name_en)                           as name_en,
                         coalesce(r.description, s.description, '')               as description,
                         r.short_description,
                         coalesce(r.difficulty, s.difficulty)::text               as difficulty,
                         coalesce(r.total_time_minutes, s.total_time_minutes)     as total_time_minutes,
                         r.image
                  from include_dish d
                           left join recipes r on r.id = d.recipe_id
                           left join recipe_suggestions s on s.id = d.suggestion_id
                  where coalesce(d.recipe_id, d.suggestion_id) is not null),

     merged as (select * from evidence
                union all
                select p.course_type,
                       p.source,
                       p.pair_rank,
                       p.dish_key,
                       p.is_recipe,
                       p.dish_id,
                       p.name,
                       p.name_en,
                       p.description,
                       p.short_description,
                       p.difficulty,
                       p.total_time_minutes,
                       p.image,
                       -- A CASE rather than two subqueries concatenated:
                       -- `jsonb_agg` over no rows is NULL, and NULL || x is
                       -- NULL, so the obvious union of the two halves empties
                       -- the card of whichever kind of dish this is.
                       case
                           when p.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                                              from recipe_ingredients ri
                                                       join ingredients i on i.id = ri.ingredient_id
                                              where ri.recipe_id = p.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name))
                                          from recipe_suggestion_ingredients rsi
                                                   join ingredients i on i.id = rsi.ingredient_id
                                          where rsi.recipe_suggestion_id = p.dish_id), '[]'::jsonb)
                           end,
                       case
                           when p.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = p.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                          from recipe_suggestion_tags rst
                                                   join tags t on t.id = rst.tag_id
                                          where rst.recipe_suggestion_id = p.dish_id), '[]'::jsonb)
                           end
                from proposal p
                union all
                select i.course_type,
                       i.source,
                       i.pair_rank,
                       i.dish_key,
                       i.is_recipe,
                       i.dish_id,
                       i.name,
                       i.name_en,
                       i.description,
                       i.short_description,
                       i.difficulty,
                       i.total_time_minutes,
                       i.image,
                       case
                           when i.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', ing.id, 'name', ing.name))
                                              from recipe_ingredients ri
                                                       join ingredients ing on ing.id = ri.ingredient_id
                                              where ri.recipe_id = i.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', ing.id, 'name', ing.name))
                                          from recipe_suggestion_ingredients rsi
                                                   join ingredients ing on ing.id = rsi.ingredient_id
                                          where rsi.recipe_suggestion_id = i.dish_id), '[]'::jsonb)
                           end,
                       case
                           when i.is_recipe
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = i.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'type', t.type))
                                          from recipe_suggestion_tags rst
                                                   join tags t on t.id = rst.tag_id
                                          where rst.recipe_suggestion_id = i.dish_id), '[]'::jsonb)
                           end
                from included i),

     -- How much each layer is worth, as one number the two orderings below
     -- share. A boolean `source = 'menu'` did this while there were two layers
     -- and cannot express three — and the reader's own pick has to outrank both
     -- of the others, or the per-course cut can drop the one dish they chose.
     weighted as (select m.*,
                         case m.source
                             when 'chosen' then 0
                             when 'menu' then 1
                             else 2
                             end as source_rank
                  from merged m),

     -- One row per dish, the most authoritative layer winning a tie. `distinct
     -- on` over the dish key rather than a `group by`, so a dish that is both
     -- evidence and a proposal keeps its evidence ranking rather than appearing
     -- twice — and one the reader chose keeps its place whatever else it is.
     deduped as (select distinct on (w.dish_key) w.*
                 from weighted w
                 order by w.dish_key,
                          w.source_rank,
                          w.pair_rank),

     ranked as (select d.*,
                       row_number() over (
                           partition by d.course_type
                           order by d.source_rank,
                                    d.pair_rank,
                                    difficulty_preference_rank(d.difficulty, p_difficulty),
                                    d.name
                           ) as slot_rank
                from deduped d)

select rk.course_type,
       rk.source,
       rk.slot_rank::integer,
       rk.dish_key,
       rk.is_recipe,
       rk.dish_id,
       rk.name,
       rk.name_en,
       coalesce(rk.description, ''),
       rk.short_description,
       rk.difficulty,
       rk.total_time_minutes,
       rk.image,
       coalesce(rk.ingredients, '[]'::jsonb),
       coalesce(rk.tags, '[]'::jsonb)
from ranked rk
where rk.slot_rank <= greatest(p_per_course, 1);
$function$;

