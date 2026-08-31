------------------------------------------------------------------------------
-- find_near_miss_recipes: the dishes that are one swap from suiting you
------------------------------------------------------------------------------
--
-- `find_recipes` is binary. A dish either satisfies every hard predicate or it
-- is not in the result, and when the result runs out the app pays a model to
-- write a new dish. There is no rung between them for *the catalogue holds this
-- dish and it is one ingredient away from being yours* — which, measured over
-- the 62 catalogue recipes, is a larger set than the one that qualifies: 21
-- gluten-free dishes and 24 more one blocker away, 13 vegan and 18 more.
--
-- This is the retrieval half of that rung and nothing else. It ADAPTS NOTHING.
-- It returns the recipe plus the single ingredient standing in the way, so a
-- caller can name the swap and let the reader judge it. A tap opens the
-- catalogue recipe as it is.
--
-- ## The whole difficulty is that "one ingredient away" does not mean "close"
--
-- Bak Kut Teh is one ingredient from vegan. The ingredient is the pork ribs.
-- Cheeseburger is one from vegetarian, and it is the beef; Abalone Porridge one
-- from shellfish-free, and it is the abalone. Structurally those are identical
-- to Apfelpfannkuchen being one from dairy-free because of the butter — same
-- query, same distance — and offering the first four is not a thin feature, it
-- is the app announcing it does not know what food is.
--
-- Measured on the live catalogue, 2026-08-30: of the 161 (dish, diet) pairs at
-- distance one, 96 are gutted dishes. Every one of those 96 has a blocker
-- carrying `meat`, `fish`, `shellfish`, `slaughter_derived`, `gluten`, `grain`,
-- `legume` or `soy`. That is not a coincidence and it is the discriminator:
-- those properties belong to things a dish is BUILT from, and the six in
-- `near_miss_swappable_properties` below belong to things a dish is COOKED IN
-- or FINISHED WITH. Three cheap structural tests on top of that (below) take
-- the remaining 65 down to 37, all of them genuine.
--
-- ### What that costs, stated
--
-- The obvious example this rules out is soy sauce -> tamari, which is a real
-- swap a real cook makes. Soy sauce is classified `{gluten, soy, grain}`,
-- indistinguishable by property from Spaghetti, and no structural test
-- separates "seasoning that happens to contain wheat" from "the noodles". So
-- gluten-free and soy-free produce almost no rail. That is the deliberate
-- direction: a rail that is narrow and right beats one that is broad and
-- occasionally absurd, because a single Vegetarian Bak Kut Teh discredits every
-- correct row beside it.
--
-- Widening it is an INSERT into the table below plus a re-measurement — which
-- is why the list is a table and not an array literal in this function.
--
-- ### The one known survivor
--
-- Margherita Pizza is one ingredient from vegan and dairy-free, and the
-- ingredient is the mozzarella. Nothing structural says so: mozzarella is
-- dairy-only, `component_kind` is null, and the dish is named for its colours
-- rather than its cheese. It is kept knowingly, and it is safe ONLY because
-- this function adapts nothing — "uses mozzarella" is a true sentence about a
-- real recipe, and the card opens that recipe. It would stop being safe the
-- moment something offers to write a dairy-free Margherita, which is what the
-- adaptation gate is for.
--
-- ## Written for the CLIENT, so SECURITY INVOKER
--
-- The opposite of `menu_pairings_for_recipe`, which restates the visibility
-- rule in its own WHERE clause because the API reaches it as the service role.
-- The near-miss rail is drawn by the search screen, which talks to PostgREST
-- under the caller's own JWT — so RLS is the mechanism, and this body reads
-- `recipes`, `recipe_ingredients`, `recipe_tags` and `ingredients` directly
-- rather than through `recipe_dietary`. That is not a stylistic choice:
-- `recipe_dietary` is a view WITHOUT `security_invoker`, so it sees past the
-- policies, and routing an owned recipe's ingredients through it would be a
-- leak this function has no reason to risk. The blocker arithmetic is cheap
-- enough to do from the base tables.
--
-- ## Recipes only, deliberately
--
-- `find_recipes` returns suggestions alongside recipes; this does not. A
-- suggestion has no recipe to open, so its card routes to the generate screen —
-- and generating from a suggestion whose ingredient list still holds the
-- blocker produces a dish with the blocker in it. The rail would be offering a
-- swap it has no way to make. Recipes have a row to show.

------------------------------------------------------------------------------
-- Which properties may be swapped at all
------------------------------------------------------------------------------
--
-- A table for the reason `dietary_rules` is one: it is reference data, it is
-- the whole of a safety decision, and loosening it should be an INSERT with a
-- measurement behind it rather than a migration that rewrites a function.
--
-- Read it as "things a dish is cooked in or finished with". A fat, a dairy
-- enrichment, a binder, a seasoning oil, a sweetener, a garnish nut. Swapping
-- one changes how a dish is made; swapping a `meat` or a `grain` changes what
-- it IS.
--
-- `refined_sugar` is here for paleo and is the weakest of the six — sugar is
-- structural in a dessert in a way ghee is not in a cutlet. It survives because
-- no catalogue row currently reaches the rail through it, so it is untested
-- rather than wrong. Take it out if that changes and the results look off.

create table if not exists near_miss_swappable_properties
(
    property dietary_property primary key
);

comment on table near_miss_swappable_properties is
    'Dietary properties whose carrier can be swapped without destroying the dish. The gate on find_near_miss_recipes — see 20260830000001 for how the list was measured.';

insert into near_miss_swappable_properties (property)
values ('dairy'),
       ('egg'),
       ('honey'),
       ('sesame'),
       ('nuts'),
       ('refined_sugar')
on conflict (property) do nothing;

alter table near_miss_swappable_properties enable row level security;

create policy public_read on near_miss_swappable_properties for select
    using (true);

------------------------------------------------------------------------------
-- Is the blocker named in the dish?
------------------------------------------------------------------------------
--
-- Free, structural, and it is what kills Beurre Blanc ("French Butter Sauce"),
-- Cheeseburger (American Cheese), Egg Foo Young and Yakgwa ("Honey Cookie").
-- A dish whose own title names the ingredient is a dish defined by it, in every
-- case measured.
--
-- Both name columns, because the giveaway is as often in the English rendering
-- as in the native one — "Beurre Blanc" shares no token with "Butter" and
-- "French Butter Sauce" shares the whole word. The accent-folded twins, so the
-- comparison is the same fold `fold_accents` gives every other search surface.
--
-- SUBSTRING containment rather than whole-word, and that direction is chosen:
-- whole-word keeps Cheeseburger (the blocker is "American Cheese" and the dish
-- is one word), while substring costs only over-rejection — a "Doughnut"
-- refused for a "Pine Nut" blocker. Over-rejection is the failure this whole
-- function is tuned toward.
--
-- Tokens shorter than three characters are dropped: they carry no meaning in an
-- ingredient name and would match almost any dish.

create or replace function public.blocker_named_in_dish(
    p_dish_text text,
    p_blocker_text text
)
    returns boolean
    language sql
    immutable
as
$function$
select exists (select 1
               from unnest(regexp_split_to_array(lower(coalesce(p_blocker_text, '')), '[^a-z0-9]+')) w
               where length(w) >= 3
                 and lower(coalesce(p_dish_text, '')) like '%' || w || '%');
$function$;

comment on function public.blocker_named_in_dish(text, text) is
    'Whether a blocking ingredient is named in the dish''s own title. Accent-folded text on both sides; see 20260830000001.';

------------------------------------------------------------------------------
-- find_near_miss_recipes
------------------------------------------------------------------------------
--
-- ## The blockers are counted over the UNION of the requested diets
--
-- Not per diet. Someone on vegan AND gluten-free wants one dish they can eat,
-- so "one change away" has to mean one change away from suiting BOTH — a
-- recipe blocked by butter for vegan and by pasta for gluten-free is two
-- changes away and must not appear, even though it is at distance one from
-- each diet taken alone. Unioning the forbidden property sets gets that for
-- free, and `blocked_diets` reports which of them the single blocker offends.
--
-- ## An unclassified ingredient is a blocker and can never BE the blocker
--
-- It counts toward the distance — `dietary_classified_at is null` means "cannot
-- promise this dish is free of it", which is the same three-valued rule
-- `recipe_dietary` fails closed on — so a recipe with one forbidden ingredient
-- and one unclassified one is at distance two and does not appear. But it can
-- never be the ingredient we NAME, because naming it would be saying "swap this
-- and the dish is vegan" about something nobody has checked. Hence the
-- `dietary_classified_at is not null` test on the blocker itself.
--
-- ## The non-derivable diets are a hard requirement, not a near-miss axis
--
-- Eight of the nineteen dietary tags (halal, kosher, keto, low carb, low fat,
-- low sodium, high protein, flexitarian) have no `dietary_rules` row, so there
-- is no ingredient-level blocker to name and no swap to propose. A recipe has
-- to carry those tags outright to reach the rail. That is the same fail-closed
-- answer `find_recipes` gives, and it means a reader whose only restriction is
-- one of the eight sees no rail — correctly, since nothing here can reason
-- about their diet at all.

create or replace function public.find_near_miss_recipes(
    p_diets uuid[] default '{}'::uuid[],
    p_ingredients uuid[] default '{}'::uuid[],
    p_tags uuid[] default '{}'::uuid[],
    p_blacklist uuid[] default '{}'::uuid[],
    p_exclude uuid[] default '{}'::uuid[],
    p_difficulty text default null,
    p_limit integer default 6
)
    returns table
            (
                id                 uuid,
                name               text,
                description        text,
                short_description  text,
                image              text,
                difficulty         text,
                favourite_count    integer,
                total_time_minutes integer,
                ingredients        jsonb,
                tags               jsonb,
                blocker_id         uuid,
                blocker_name       text,
                blocked_diets      text[]
            )
    language sql
    stable
as
$function$
with
    -- The requested dietary tags, split the way `find_recipes` splits them: a
    -- diet with a rule is answered from the ingredients, one without it from
    -- the tag the row carries.
    diets as (select t.id                               as tag_id,
                     t.canonical_id,
                     dr.forbidden,
                     (dr.diet_canonical_id is not null) as is_derived
              from unnest(p_diets) as req(id)
                       join tags t on t.id = req.id and t.type = 'dietary'
                       left join dietary_rules dr
                                 on dr.diet_canonical_id = t.canonical_id),

    derived as (select * from diets where is_derived),

    -- Every property any requested derivable diet forbids. The union is what
    -- makes "one change" mean one change for all of them at once.
    forbidden as (select coalesce(
                                 (select array_agg(distinct p)
                                  from derived d,
                                       unnest(d.forbidden) as p),
                                 '{}'::dietary_property[]) as props),

    -- Subtree expansion for the session tags and the tag-carried diets, as
    -- `find_recipes` does (20260803000002).
    tag_roots as (select id
                  from unnest(p_tags) as t(id)
                  union
                  select tag_id from diets where not is_derived),

    tag_expanded as (select s.root_id, s.tag_id
                     from tag_subtree(array(select id from tag_roots)) s),

    tag_root_count as (select count(*)::integer as n from tag_roots),

    -- Candidates: every visible recipe passing the predicates that are NOT
    -- being relaxed. Variants included, collapsed below — the same construction
    -- `find_recipes` uses, so an escalated hard copy is reachable and a dish
    -- still never occupies two rows.
    --
    -- RLS on `recipes` is what scopes this to the shared catalogue plus the
    -- caller's own imports; see the header.
    candidate as (select r.id,
                         r.name,
                         r.description,
                         r.short_description,
                         r.image,
                         r.difficulty::text                as difficulty,
                         r.favourite_count,
                         r.total_time_minutes,
                         lower(coalesce(r.name_ascii, '') || ' ' ||
                               coalesce(r.name_en_ascii, ''))
                                                           as dish_text,
                         coalesce(r.base_recipe_id, r.id)   as family_id,
                         r.base_recipe_id
                  from recipes r
                  where not (r.id = any (p_exclude))
                    and (coalesce(array_length(p_ingredients, 1), 0) = 0
                      or (select count(distinct ri.ingredient_id)
                          from recipe_ingredients ri
                          where ri.recipe_id = r.id
                            and ri.ingredient_id = any (p_ingredients)) =
                         array_length(p_ingredients, 1))
                    and (coalesce(array_length(p_blacklist, 1), 0) = 0
                      or not exists (select 1
                                     from recipe_ingredients rib
                                     where rib.recipe_id = r.id
                                       and rib.ingredient_id = any (p_blacklist)))
                    -- Session tags and the tag-carried diets, both outright.
                    -- Counted off the requested roots rather than off what
                    -- resolved, so an id matching no tag makes the filter
                    -- unsatisfiable instead of being ignored.
                    and ((select n from tag_root_count) = 0
                      or (select count(*)
                          from tag_roots q
                          where exists (select 1
                                        from tag_expanded s
                                                 join recipe_tags rt
                                                      on rt.recipe_id = r.id
                                                          and rt.tag_id = s.tag_id
                                        where s.root_id = q.id)) =
                         (select n from tag_root_count))),

    -- What stands between each candidate and every requested derivable diet.
    -- Unclassified counts, for the reason in the header.
    blocker as (select c.id                    as recipe_id,
                       i.id                    as ingredient_id,
                       i.name                  as ingredient_name,
                       i.name_ascii,
                       i.dietary_properties,
                       i.component_kind,
                       (i.dietary_classified_at is not null) as classified
                from candidate c
                         join recipe_ingredients ri on ri.recipe_id = c.id
                         join ingredients i on i.id = ri.ingredient_id
                         cross join forbidden f
                where i.dietary_classified_at is null
                   or i.dietary_properties && f.props),

    -- Exactly one, and it must be one we are willing to name.
    --
    -- `array_agg(distinct …)[1]` rather than `min()`, which has no uuid
    -- overload. The HAVING clause is what makes it well-defined: the group
    -- holds exactly one distinct id, so the subscript is picking the only
    -- element rather than an arbitrary one.
    at_distance_one as (select b.recipe_id,
                               (array_agg(distinct b.ingredient_id))[1] as ingredient_id
                        from blocker b
                        group by b.recipe_id
                        having count(distinct b.ingredient_id) = 1),

    near_miss as (select c.*,
                         i.id   as blocker_id,
                         i.name as blocker_name
                  from candidate c
                           join at_distance_one d on d.recipe_id = c.id
                           join ingredients i on i.id = d.ingredient_id
                  where
                    -- Never name an ingredient nobody has checked.
                      i.dietary_classified_at is not null
                    -- The medium/protagonist split. `<@` is containment: every
                    -- property the blocker carries must be swappable, so a soy
                    -- sauce (gluten, soy, grain) is out on any one of the
                    -- three.
                    and i.dietary_properties <@
                        (select coalesce(array_agg(property), '{}'::dietary_property[])
                         from near_miss_swappable_properties)
                    -- An ingredient that is itself a dish is a protagonist:
                    -- a pizza dough, a béchamel. `classify-ingredient-component`
                    -- is what fills this in.
                    and coalesce(i.component_kind::text, '') <> 'dish'
                    -- And the dish must not be named for it.
                    and not blocker_named_in_dish(c.dish_text, i.name_ascii)),

    -- One row per dish, the copy closest to the requested skill level.
    family_pick as (select distinct on (n.family_id) n.*
                    from near_miss n
                    order by n.family_id,
                             difficulty_preference_rank(n.difficulty, nullif(p_difficulty, '')),
                             (n.base_recipe_id is not null),
                             n.id)

select f.id,
       f.name,
       f.description,
       f.short_description,
       f.image,
       f.difficulty,
       f.favourite_count,
       f.total_time_minutes,
       coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name)
                 from ingredients i
                          join recipe_ingredients ri on ri.ingredient_id = i.id
                 where ri.recipe_id = f.id), '[]'::jsonb),
       coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                 from tags t
                          join recipe_tags rt on rt.tag_id = t.id
                 where rt.recipe_id = f.id), '[]'::jsonb),
       f.blocker_id,
       f.blocker_name,
       -- Which of the reader's diets this one ingredient is standing in the way
       -- of. Usually one; "egg" blocks both vegan and egg-free for someone who
       -- set both, and a caller that wants to say so has the list.
       coalesce((select array_agg(distinct d.canonical_id order by d.canonical_id)
                 from derived d
                          join ingredients bi on bi.id = f.blocker_id
                 where bi.dietary_properties && d.forbidden), '{}'::text[])
from family_pick f
-- Same ordering as `find_recipes`, minus the source split: this returns one
-- kind of row. Skill level first because it is the reader's own stated
-- preference, then global popularity, then a stable tiebreak.
order by difficulty_preference_rank(f.difficulty, nullif(p_difficulty, '')),
         f.favourite_count desc,
         f.name,
         f.id
limit greatest(p_limit, 0);
$function$;

comment on function public.find_near_miss_recipes(uuid[], uuid[], uuid[], uuid[], uuid[], text, integer) is
    'Catalogue recipes exactly one swappable ingredient away from satisfying the caller''s diets, with that ingredient named. Retrieval only — nothing is adapted. SECURITY INVOKER: scoped by RLS on recipes. See 20260830000001.';

-- The client is the caller, under its own JWT.
grant execute on function public.find_near_miss_recipes(uuid[], uuid[], uuid[], uuid[], uuid[], text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
