-- What goes with this dish, decided once and shared by everyone.
--
-- The compose sheet has never been able to answer that question. It asks
-- `find_recipes` for dishes tagged `side` in the seed's cuisine, which is a
-- FILTER over the catalogue, not a pairing: a Tuscan side is offered for a
-- Ribollita because both are Tuscan, and nothing in that query has ever known
-- what the main was.
--
-- Meanwhile the real answer already existed on the other side of a wall.
-- `menu_pairings_for_recipe` (`20260822000001`) reads what people have actually
-- put on a plate together, ranked by saves — and it is service-role only, so
-- the picker could never see it. It runs INSIDE `/compose`, after the reader has
-- already committed to a paid stream.
--
-- This migration adds the second half and opens both to the client through one
-- read:
--
--   dish_pairing_sets — one row per main dish: when we asked, and which courses
--                       the model judged this dish actually wants.
--   dish_pairings     — the dishes themselves, per course, ranked.
--
-- ## An empty set is an ANSWER, which is why there are two tables
--
-- Some dishes do not want a menu around them. A one-pot stew wants no side; a
-- sandwich wants no dessert. With one table, "we asked and the answer was
-- nothing" and "nobody has ever asked" are the same empty result, and the sheet
-- cannot tell the reader which — so it would skeleton forever, or claim an
-- absence it has not established. The parent row is what makes "nothing goes
-- with this" a fact the client can draw.
--
-- ## Keyed on `dish_key`, never on `recipes.id`
--
-- The identity `menu_courses` already uses: `coalesce(source_suggestion_id, id)`
-- for a recipe, the row's own id for a suggestion. So a pairing set survives its
-- dish being promoted, and two people composing around the same dish at
-- different stages of its life share one set. Same argument `20260821000001`
-- makes for `dish_signature`, and the same one that makes `menu_is_publishable`
-- heal itself.
--
-- ## Nothing here is per-reader
--
-- The model is NOT told the caller's blacklist or diet, and the cache is not
-- keyed on them. A pairing is a fact about a dish; baking one reader's
-- constraints into a shared row would collapse the hit rate to nothing and make
-- the corpus unreadable to anybody else. Both are applied on the READ, exactly
-- as `menu_pairings_for_recipe` already applies them. A course thinned by
-- somebody's own diet is honestly thin, and the search field is still there.

------------------------------------------------------------------------------
-- 1. The tables
------------------------------------------------------------------------------

create table if not exists dish_pairing_sets
(
    -- The dish this set is about, as `menu_courses.dish_key` spells it. Not a
    -- foreign key for the same reason `shopping_lists.menu_main_recipe_id` is
    -- not one: it may name a `recipes` row or a `recipe_suggestions` row, and a
    -- polymorphic reference cannot be constrained to two tables at once.
    main_dish_key uuid primary key,

    -- Which of `appetizer`, `side`, `dessert` this dish actually wants, as the
    -- model judged it. Empty is a real answer and the whole reason this column
    -- is not derived from `dish_pairings` — a course can be endorsed and still
    -- come back with no dish that passed the notability gate.
    --
    -- The model's OPINION, and only that. It is never widened by a reader
    -- asking for a course it declined: the picker reads it to say "this dish
    -- doesn't usually take an appetizer", which stays true even while showing
    -- the appetizers somebody went and asked for anyway.
    courses       text[]                   not null default '{}'::text[],

    -- Which courses we have actually SOLICITED dishes for.
    --
    -- Distinct from `courses`, and separating them is what stops a course
    -- becoming a dead end. The first call asks the model what the dish wants;
    -- for Tuna Tataki it answered `{side, dessert}` and named five dishes.
    -- Nothing had asked it for an appetizer — so with one column, "a set
    -- exists" was the only test a caller could make, the appetizer row could
    -- never be filled by generation, and search was its only escape forever.
    --
    -- So an untargeted call records the ENDORSED courses here, not all three:
    -- a course the model declined has not been asked for dishes. Pressing it
    -- then fires a TARGETED call — "name appetizers for this" — which merges in
    -- and adds the course here. If that comes back empty the course is honestly
    -- exhausted, and the next press spends nothing.
    asked_courses text[]                   not null default '{}'::text[],

    -- When the model was asked. Read by the API's staleness check, and the one
    -- thing that distinguishes "asked, nothing viable" from "never asked".
    generated_at  timestamp with time zone not null default now(),

    -- The model that answered, for the same reason `recipes` records nothing of
    -- the sort and has been regretted: a set generated by a model that has since
    -- been replaced is worth re-asking, and without this there is no way to find
    -- those rows.
    model         text,

    created_at    timestamp with time zone not null default now(),

    constraint dish_pairing_sets_courses_bounded
        check (cardinality(courses) <= 4),
    constraint dish_pairing_sets_asked_bounded
        check (cardinality(asked_courses) <= 4)
);

comment on table dish_pairing_sets is
    'One row per main dish: which courses it wants (courses), which we have solicited dishes for (asked_courses), and when. A course in asked_courses with no dish_pairings under it means "we asked and found nothing" — see 20260916000001.';

create table if not exists dish_pairings
(
    id            uuid primary key                  default gen_random_uuid(),
    main_dish_key uuid                     not null references dish_pairing_sets (main_dish_key) on delete cascade,

    -- The slot this dish was proposed FOR, from the course vocabulary exactly.
    -- Never the dish's own course tag: the same rule `ComposeRecipeResultDto`
    -- spends a paragraph on, and for the same reason — a dish resolved onto a
    -- catalogue row tagged `main` must still be offered as the side it was
    -- asked for, or it lands in a bucket nothing renders.
    course_type   text                     not null,

    -- The proposed dish, normalised the same way `main_dish_key` is.
    dish_key      uuid                     not null,

    -- Best first, within a course. The model's own order.
    rank          integer                  not null default 0,

    created_at    timestamp with time zone not null default now(),

    -- One proposal per dish per main, whatever course it was proposed for. A
    -- dish that fits two slots is offered for the better one rather than twice.
    constraint dish_pairings_unique unique (main_dish_key, dish_key),

    constraint dish_pairings_not_self check (dish_key <> main_dish_key)
);

create index if not exists idx_dish_pairings_main_course
    on dish_pairings using btree (main_dish_key, course_type, rank);

create index if not exists idx_dish_pairings_dish_key
    on dish_pairings using btree (dish_key);

comment on table dish_pairings is
    'Model-proposed accompaniments for a dish, by course. Each dish_key points at an ordinary recipes or recipe_suggestions row written by persistOrReuseSuggestion — so a proposal is openable, promotable and already past the notability gate.';

------------------------------------------------------------------------------
-- 2. RLS — world-readable, service-written
------------------------------------------------------------------------------
--
-- The same shape `recipe_suggestions` has, and for the same reason: this is
-- catalogue content, not anybody's data. The difference is the WRITE side —
-- `recipe_suggestions` is open to clients for historical reasons this table
-- does not inherit. Only the API writes here, as the service role, through
-- `record_dish_pairings`; a client that could insert could put any dish in
-- front of any other reader's compose sheet.

alter table dish_pairing_sets enable row level security;
alter table dish_pairings enable row level security;

create policy public_read on dish_pairing_sets for select to anon, authenticated using (true);
create policy public_read on dish_pairings for select to anon, authenticated using (true);

-- Not redundant with the absent write policies. With RLS on and no policy an
-- INSERT errors loudly, but an UPDATE or DELETE simply matches zero rows and
-- returns 204 — so a client doing the wrong thing would look like it worked.
-- Verbatim the argument `20260821000001` makes for `menus`.
revoke insert, update, delete on dish_pairing_sets from anon, authenticated;
revoke insert, update, delete on dish_pairings from anon, authenticated;

------------------------------------------------------------------------------
-- 3. Writing a set
------------------------------------------------------------------------------
--
-- One statement, because the three it replaces are not safe apart: upsert the
-- parent, clear the old proposals, insert the new ones. A reader arriving
-- between the delete and the insert would be told this dish has nothing to go
-- with it, which is precisely the claim the parent row exists to make
-- truthfully.

-- Signature changed with `p_asked` / `p_merge`; the old arity is dropped so
-- PostgREST cannot resolve a caller onto a copy that overwrites the whole set.
drop function if exists public.record_dish_pairings(uuid, text[], jsonb, text);

create or replace function public.record_dish_pairings(
    p_main_dish_key uuid,
    p_courses       text[],
    p_pairings      jsonb,
    p_model         text default null,
    -- The courses this call SOLICITED dishes for — unioned into
    -- `asked_courses`. Defaults to `p_courses`, which is right for the
    -- untargeted call: it asked what the dish wants and got dishes for exactly
    -- the courses it endorsed.
    p_asked         text[] default null,
    -- Merge into the existing set rather than replacing it.
    --
    -- A TARGETED call fills one course the model had declined, and must not
    -- touch the others: replacing would throw away the dishes the untargeted
    -- call found, and rewriting `courses` would overwrite the model's opinion
    -- with a reader's override.
    p_merge         boolean default false
)
    returns dish_pairing_sets
    language plpgsql
    security definer
    -- `pg_temp` last and explicit: without it Postgres searches it first for
    -- table names, so a caller holding a session could shadow these tables.
    -- Same note as `save_menu` (20260821000002).
    set search_path = public, pg_temp
as
$function$
declare
    v_set   dish_pairing_sets;
    v_asked text[] := coalesce(p_asked, p_courses, '{}'::text[]);
begin
    if p_main_dish_key is null then
        raise exception using
            errcode = 'null_value_not_allowed',
            message = 'record_dish_pairings: a set needs a dish to be about';
    end if;

    insert into dish_pairing_sets (main_dish_key, courses, asked_courses, generated_at, model)
    values (p_main_dish_key,
            coalesce(p_courses, '{}'::text[]),
            v_asked,
            now(),
            p_model)
    on conflict (main_dish_key)
        do update set
            -- The model's opinion is set by the untargeted call and never
            -- widened by a targeted one — see the column's own note.
            courses       = case
                                when p_merge then dish_pairing_sets.courses
                                else excluded.courses
                                end,
            asked_courses = case
                                when p_merge then array(
                                        select distinct unnest(
                                                dish_pairing_sets.asked_courses || excluded.asked_courses)
                                        order by 1)
                                else excluded.asked_courses
                                end,
            generated_at  = excluded.generated_at,
            model         = excluded.model
    returning * into v_set;

    -- A replace clears everything; a merge clears only the courses this call
    -- went and asked about, so the dishes the first call found survive.
    if p_merge then
        delete from dish_pairings
        where main_dish_key = p_main_dish_key
          and course_type = any (v_asked);
    else
        delete from dish_pairings where main_dish_key = p_main_dish_key;
    end if;

    -- `distinct on` rather than a plain insert: the caller assembles this list
    -- from a model's output after dedup has resolved several names onto one
    -- row, so the same dish can legitimately arrive twice under two courses.
    -- The unique constraint would abort the whole write; keeping the
    -- better-ranked copy is the answer the constraint is there to express.
    --
    -- The `not exists` is the merge's other half: a targeted call must not
    -- re-offer a dish another course of this set is already holding, and the
    -- constraint is per (main, dish) rather than per course.
    insert into dish_pairings (main_dish_key, course_type, dish_key, rank)
    select distinct on (e.dish_key)
           p_main_dish_key,
           e.course_type,
           e.dish_key,
           e.rank
    from jsonb_to_recordset(coalesce(p_pairings, '[]'::jsonb))
             as e(course_type text, dish_key uuid, rank integer)
    where e.dish_key is not null
      and e.course_type is not null
      and e.dish_key <> p_main_dish_key
      and not exists (select 1
                      from dish_pairings existing
                      where existing.main_dish_key = p_main_dish_key
                        and existing.dish_key = e.dish_key)
    order by e.dish_key, e.rank;

    return v_set;
end;
$function$;

comment on function public.record_dish_pairings(uuid, text[], jsonb, text, text[], boolean) is
    'Write a dish''s proposed pairings. `p_merge` fills the courses in `p_asked` and leaves the rest — what a targeted "name me an appetizer" call needs. See 20260916000001.';

revoke all on function public.record_dish_pairings(uuid, text[], jsonb, text, text[], boolean) from public;

------------------------------------------------------------------------------
-- 4. Does this dish suit the caller?
------------------------------------------------------------------------------
--
-- The blacklist and diet test, pulled out so the read below is legible.
--
-- **This duplicates the `keep` CTE inside `menu_pairings_for_recipe`, and that
-- is a deliberate, bounded duplication rather than an oversight.** Rewriting
-- that function to call this one would put a per-row function call inside a
-- query that is already the most expensive read in compose, for no behaviour
-- change, on the one path a paid stream depends on. The two must agree; if a
-- third caller ever appears, consolidate then and measure.
--
-- Note the dietary half has two shapes on purpose, exactly as it does there: a
-- DERIVED diet (one with a `dietary_rules` row) is proven from the classified
-- ingredients via `recipe_dietary`, and a plain tag diet from the tag subtree.
-- Treating them alike is what once let a recipe show a "Gluten free" chip that
-- `find_recipes` refused to honour.

create or replace function public.dish_meets_constraints(
    p_dish_id   uuid,
    p_is_recipe boolean,
    p_blacklist uuid[],
    p_dietary   text[]
)
    returns boolean
    language sql
    stable
as
$function$
with diets as (select distinct t.id                              as tag_id,
                               t.canonical_id,
                               (dr.diet_canonical_id is not null) as is_derived
               from unnest(coalesce(p_dietary, '{}'::text[])) d
                        join tags t
                             on t.type = 'dietary'
                                 and lower(btrim(t.name)) = lower(btrim(d))
                        left join dietary_rules dr on dr.diet_canonical_id = t.canonical_id
               where btrim(d) <> ''),

     diet_tags as (select s.root_id, s.tag_id
                   from tag_subtree(array(select tag_id from diets where not is_derived)) s)

select
    -- Nothing the caller will not eat.
    (coalesce(array_length(p_blacklist, 1), 0) = 0
        or (p_is_recipe and not exists (select 1
                                        from recipe_ingredients ri
                                        where ri.recipe_id = p_dish_id
                                          and ri.ingredient_id = any (p_blacklist)))
        or (not p_is_recipe and not exists (select 1
                                            from recipe_suggestion_ingredients rsi
                                            where rsi.recipe_suggestion_id = p_dish_id
                                              and rsi.ingredient_id = any (p_blacklist))))

    -- And every diet satisfied. Absence is disqualifying, not unknown: a dish
    -- that cannot PROVE it is vegan is not offered to somebody who is.
    and not exists (select 1
                    from diets dt
                    where not (case
                                   when dt.is_derived
                                       then (p_is_recipe and exists (select 1
                                                                     from recipe_dietary rd
                                                                     where rd.recipe_id = p_dish_id
                                                                       and rd.diet_canonical_id = dt.canonical_id))
                                           or (not p_is_recipe and exists (select 1
                                                                           from recipe_suggestion_dietary rsd
                                                                           where rsd.recipe_suggestion_id = p_dish_id
                                                                             and rsd.diet_canonical_id = dt.canonical_id))
                                   else (p_is_recipe and exists (select 1
                                                                 from diet_tags s
                                                                          join recipe_tags rt
                                                                               on rt.recipe_id = p_dish_id
                                                                                   and rt.tag_id = s.tag_id
                                                                 where s.root_id = dt.tag_id))
                                       or (not p_is_recipe and exists (select 1
                                                                       from diet_tags s
                                                                                join recipe_suggestion_tags rst
                                                                                     on rst.recipe_suggestion_id = p_dish_id
                                                                                         and rst.tag_id = s.tag_id
                                                                       where s.root_id = dt.tag_id))
                        end));
$function$;

comment on function public.dish_meets_constraints(uuid, boolean, uuid[], text[]) is
    'Does this dish pass the caller''s blacklist and diet? Mirrors the keep CTE in menu_pairings_for_recipe — the two must agree. See 20260916000001.';

grant execute on function public.dish_meets_constraints(uuid, boolean, uuid[], text[]) to anon, authenticated;

------------------------------------------------------------------------------
-- 5. The read the picker makes
------------------------------------------------------------------------------
--
-- Two layers in one answer, ordered by how much they are worth:
--
--   `menu`     — somebody put this on a plate with the main. Evidence.
--   `proposed` — the model was asked what goes with the main. An opinion.
--
-- Evidence leads, always: a dish in a saved menu was chosen by a person and
-- ranked by how many people kept it. The proposals fill in behind. Both are
-- pairings; nothing is offered here for merely sharing a tag, which is the
-- whole point of the change.
--
-- SECURITY DEFINER, because it reads `menus` through `menu_pairings_for_recipe`
-- — which is service-role only and restates the visibility rule itself — and
-- because it must not be possible for a caller to reach a private menu's
-- courses by asking for pairings. Everything it returns is already public:
-- `menu_is_publishable` requires `owner_profile_id is null` inside that
-- function, and `dish_pairings` is world-readable.

-- Dropped before the create because `p_include` CHANGES THE SIGNATURE, and
-- `create or replace` would leave the six-argument form behind as an overload.
-- PostgREST resolves by the argument names a caller sends, so a client that
-- omitted `p_include` would silently bind to the old copy — the one that cannot
-- see the reader's own pick, which is the whole defect this parameter fixes.
drop function if exists public.pairing_candidates_for_recipe(
    uuid, text[], integer, uuid[], text[], text);

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
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = p.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
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
                               then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                                              from recipe_tags rt
                                                       join tags t on t.id = rt.tag_id
                                              where rt.recipe_id = i.dish_id), '[]'::jsonb)
                           else coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
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

comment on function public.pairing_candidates_for_recipe(uuid, text[], integer, uuid[], text[], text, jsonb) is
    'What goes with this dish: the caller''s own picks first, then saved-menu evidence, then model proposals — the last two filtered by the caller''s blacklist and diet. The one read the compose picker and the composer both make. See 20260916000001.';

-- No grant. The API is the only caller and reaches it as the service role —
-- the same rule `menu_pairings_for_recipe` carries, and for a sharper reason
-- here: this function is SECURITY DEFINER and embeds one that is service-only,
-- so a grant to `authenticated` would hand every client a door past the wall
-- that function was put behind.
revoke all on function public.pairing_candidates_for_recipe(uuid, text[], integer, uuid[], text[], text, jsonb) from public;

notify pgrst, 'reload schema';
