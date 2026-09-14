-- Retrieval for "give me a recipe WITH béchamel".
--
-- The read side of `20260913000003`. It answers the request the catalogue could
-- never answer: not "make me a béchamel" but "make me something built on one".
--
-- WHY IT IS A SEPARATE FUNCTION AND NOT A PARAMETER ON `find_recipes`
-- `find_recipes`' `ingredients` array is a conjunctive FILTER, and three callers
-- depend on that — most sharply the client's search screen, where a SHORT PAGE
-- is the signal that the catalogue is exhausted and it is time to generate
-- (`getNextPageParam` in `use-find-recipes`). Widening that filter in place
-- makes every page full, so the app quietly stops generating: a behaviour change
-- that costs money in the direction nobody would look. The same argument
-- `p_pantry` made for ranking-not-filtering applies here to a different axis.
--
-- It deliberately returns `find_recipes_result`, even though the pantry and
-- facet columns are unused, so chat's existing decoder (`toNamedRows`, the
-- `CatalogueRecipe` mapper) reads it with no second shape to keep in step.
--
-- AND, not OR, across components — "a dish with béchamel AND tomato sauce" means
-- both. Same semantics as `find_recipes`' ingredient filter, and for the same
-- reason: a request naming two things is not asking for either.
create or replace function public.find_dishes_using_components(
    p_components uuid[],
    p_blacklist uuid[] default '{}',
    p_dietary_tags uuid[] default '{}',
    p_exclude_dish_ids uuid[] default '{}',
    p_limit integer default 5
)
    returns setof public.find_recipes_result
    language sql
    stable
    security definer
    set search_path = public
as
$$
with
    requested as (select distinct unnest(p_components) as req_id),
    -- Each requested component closed over `ingredient_aliases`, in both
    -- directions and transitively — the same closure `find_recipes` applies to
    -- its ingredient ids. A component reached through an alias is the same
    -- component.
    --
    -- **Expanded PER REQUESTED ID, never flattened into one set.** Closing two
    -- requests into four ids and then counting distinct matches would demand all
    -- four, which makes the filter HARDER rather than wider — the exact trap
    -- `20260902000001` records for `p_pantry`. The count below is over `req_id`
    -- for that reason.
    expanded as (
        select r.req_id,
               unnest(public.ingredient_identity_ids(array [r.req_id])) as ingredient_id
        from requested r
    ),
    wanted as (select count(*)::int as n from requested),
    -- Every dish carrying ALL the requested components.
    matched as (
        select dc.dish_id, dc.source
        from public.dish_components dc
        join expanded e on e.ingredient_id = dc.ingredient_id
        group by dc.dish_id, dc.source
        having count(distinct e.req_id) = (select n from wanted)
    ),
    recipes_matched as (
        select r.id,
               r.name,
               r.description,
               r.short_description,
               r.image,
               r.difficulty::text,
               coalesce(r.favourite_count, 0) as favourite_count,
               r.total_time_minutes,
               'recipe'::text as source,
               r.origin::text as origin
        from matched m
        join public.recipes r on r.id = m.dish_id
        where m.source = 'recipe'
          -- SECURITY DEFINER, so no policy applies and the rule is written out.
          -- An owned (imported) recipe is nobody else's to retrieve.
          and r.created_by is null
          and not (r.id = any (p_exclude_dish_ids))
          and (
              cardinality(p_blacklist) = 0
              or not exists (
                  select 1 from public.recipe_ingredients ri
                  where ri.recipe_id = r.id
                    and ri.ingredient_id = any (
                        public.ingredient_identity_ids(p_blacklist)
                    )
              )
          )
          and (
              cardinality(p_dietary_tags) = 0
              or not exists (
                  select 1 from unnest(p_dietary_tags) as want(tag_id)
                  where not exists (
                      select 1 from public.recipe_dietary rd
                      join public.tags t on t.canonical_id = rd.diet_canonical_id
                      where rd.recipe_id = r.id and t.id = want.tag_id
                  )
                  and not exists (
                      select 1 from public.recipe_tags rt
                      where rt.recipe_id = r.id and rt.tag_id = want.tag_id
                  )
              )
          )
    ),
    suggestions_matched as (
        select s.id,
               s.name,
               s.description,
               s.description as short_description,
               null::text as image,
               s.difficulty::text,
               0 as favourite_count,
               s.total_time_minutes,
               'suggestion'::text as source,
               'generated'::text as origin
        from matched m
        join public.recipe_suggestions s on s.id = m.dish_id
        where m.source = 'suggestion'
          and not (s.id = any (p_exclude_dish_ids))
          and (
              cardinality(p_blacklist) = 0
              or not exists (
                  select 1 from public.recipe_suggestion_ingredients si
                  where si.recipe_suggestion_id = s.id
                    and si.ingredient_id = any (
                        public.ingredient_identity_ids(p_blacklist)
                    )
              )
          )
          and (
              cardinality(p_dietary_tags) = 0
              or not exists (
                  select 1 from unnest(p_dietary_tags) as want(tag_id)
                  where not exists (
                      select 1 from public.recipe_suggestion_dietary sd
                      join public.tags t on t.canonical_id = sd.diet_canonical_id
                      where sd.recipe_suggestion_id = s.id and t.id = want.tag_id
                  )
                  and not exists (
                      select 1 from public.recipe_suggestion_tags st
                      where st.recipe_suggestion_id = s.id and st.tag_id = want.tag_id
                  )
              )
          )
    ),
    combined as (
        select * from recipes_matched
        union all
        select * from suggestions_matched
    )
select c.id,
       c.name,
       c.description,
       c.short_description,
       c.image,
       c.difficulty,
       c.favourite_count,
       coalesce(
           (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name)
                             order by i.name)
            from public.recipe_ingredients ri
            join public.ingredients i on i.id = ri.ingredient_id
            where c.source = 'recipe' and ri.recipe_id = c.id),
           (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name)
                             order by i.name)
            from public.recipe_suggestion_ingredients si
            join public.ingredients i on i.id = si.ingredient_id
            where c.source = 'suggestion' and si.recipe_suggestion_id = c.id),
           '[]'::jsonb
       ) as ingredients,
       coalesce(
           (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)
                             order by t.name)
            from public.recipe_tags rt
            join public.tags t on t.id = rt.tag_id
            where c.source = 'recipe' and rt.recipe_id = c.id),
           (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)
                             order by t.name)
            from public.recipe_suggestion_tags st
            join public.tags t on t.id = st.tag_id
            where c.source = 'suggestion' and st.recipe_suggestion_id = c.id),
           '[]'::jsonb
       ) as tags,
       c.source,
       c.total_time_minutes,
       c.origin,
       -- Totals and facets belong to the search screen's pagination, which does
       -- not call this. Zeroed rather than computed: an honest zero is cheaper
       -- than a number nothing reads.
       0 as total_recipes,
       0 as total_suggestions,
       '{}'::jsonb as facets,
       0 as pantry_have,
       0 as pantry_missing,
       '[]'::jsonb as pantry_missing_ingredients
from combined c
-- A real recipe beats a suggestion (it can be opened rather than generated),
-- then the most-liked, then oldest-stable by id so paging is deterministic.
order by (c.source = 'recipe') desc, c.favourite_count desc, c.id
limit greatest(p_limit, 0);
$$;

comment on function public.find_dishes_using_components(uuid[], uuid[], uuid[], uuid[], integer) is
    'Dishes BUILT ON the given components (AND across them). The read side of recipe_components. Deliberately separate from find_recipes, whose ingredient array is a conjunctive filter three callers depend on — see the migration header.';

-- Service role only. The app reaches this through the API (chat), not directly,
-- and SECURITY DEFINER means an accidental grant would hand out private rows —
-- the exact defect `ai_quota_status_for` had to be repaired for. Supabase's base
-- setup grants EXECUTE to anon/authenticated on new functions, so `revoke ...
-- from public` does NOT cover it and the roles are named.
revoke execute on function
    public.find_dishes_using_components(uuid[], uuid[], uuid[], uuid[], integer)
    from public, anon, authenticated;
