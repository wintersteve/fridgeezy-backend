-- Make find_recipes match a requested tag against that tag's SUBTREE.
--
-- THE PROBLEM
-- `tags` are matched by exact id, so a filter only ever hits recipes carrying
-- that precise tag. Cuisine tags are a populated 3-level tree — 5 continental
-- roots, ~25 regions, ~140 leaves, all wired through `tags.parent_id` — and
-- dishes are tagged with the LEAF ("japanese"). Selecting "asian" or "east
-- asian" therefore returned nothing at all, and the entire upper two thirds of
-- the cuisine vocabulary was dead weight in the filter list.
--
-- THE FIX
-- A requested tag is satisfied by the tag itself OR by any descendant of it.
-- Selecting "asian" now matches every japanese/thai/vietnamese/… dish beneath
-- it; selecting "japanese" behaves exactly as before, because a leaf's subtree
-- is just itself.
--
-- Deliberately generic rather than cuisine-specific: the rule is a property of
-- `tags.parent_id`, and course/component/dietary tags are currently flat, so
-- for them subtree = self and this is a no-op. If a dietary or course hierarchy
-- is introduced later it inherits the behaviour for free.
--
-- WHAT DOES NOT CHANGE
-- Requested tags are still combined with AND — a recipe must satisfy every one
-- of them. Only the test for a SINGLE requested tag widens, from "has this tag"
-- to "has this tag or something under it". So "vegan" + "asian" still means
-- vegan AND asian, which is what a dietary restriction needs.

-- (root_id, tag_id) for every tag at or below each root: the identity pair plus
-- one row per descendant.
--
-- UNION, not UNION ALL: it deduplicates, so a parent_id cycle terminates
-- instead of recursing forever. The tree is seeded acyclic and only three deep,
-- but `matchTags` writes new cuisine rows at runtime and nothing enforces
-- acyclicity, so this must not be able to hang the feed.
create or replace function public.tag_subtree(root_ids uuid[])
    returns table
            (
                root_id uuid,
                tag_id  uuid
            )
    language sql
    stable
    parallel safe
as
$function$
with recursive tree as (select r.id as root_id,
                               r.id as tag_id
                        from unnest(root_ids) as r(id)
                        union
                        select tree.root_id,
                               t.id
                        from tags t
                                 join tree on t.parent_id = tree.tag_id)
select root_id, tag_id
from tree;
$function$;

create or replace function public.find_recipes(p_difficulty text default null::text,
                                               ingredients uuid[] default array []::uuid[],
                                               tags uuid[] default array []::uuid[],
                                               blacklist uuid[] default array []::uuid[],
                                               limit_count integer default 10)
    returns setof find_recipes_result
    language plpgsql
    security definer
as $function$
declare
difficulty_filter text := null;
  -- How many DISTINCT tags must be satisfied. Counted here rather than read off
  -- array_length so a caller passing the same id twice (a slot and the generic
  -- `tags` list both carrying it) no longer makes the filter unsatisfiable.
  requested_tag_count integer := (select count(distinct t) from unnest(tags) as t);
begin
  -- Normalize difficulty preference
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
  /* -------------------------------------------------
   * 0. Every tag that can satisfy each requested tag — the tag itself plus its
   * descendants. Expanded ONCE here, not per candidate row.
   * ------------------------------------------------- */
  requested_tags as (
    select s.root_id, s.tag_id
    from tag_subtree(tags) s
  ),

  /* -------------------------------------------------
   * 1a. Every recipe passing the hard filters — variants INCLUDED.
   *
   * `base_recipe_id is null` used to sit here, which is why a dish whose only
   * copy at the requested difficulty was a variant could never be found: the
   * escalated "hard" row was dropped before anything looked at difficulty, and
   * discovery always fell back to the medium base. That exclusion existed to
   * stop one dish occupying several rows of the feed — 1b keeps that guarantee
   * without throwing the other difficulties away.
   * ------------------------------------------------- */
  matching_recipes as (
    select
      r.id,
      r.name,
      r.description,
      r.short_description,
      r.image,
      r.difficulty::text as difficulty,
      r.favourite_count,
      -- A dish's family: its base's id, or its own when it IS the base.
      coalesce(r.base_recipe_id, r.id) as family_id,
      r.base_recipe_id
    from recipes r
    where
      (
        coalesce(array_length(ingredients, 1), 0) = 0
        or (
          select count(distinct ri.ingredient_id)
          from recipe_ingredients ri
          where ri.recipe_id = r.id
            and ri.ingredient_id = any (ingredients)
        ) = array_length(ingredients, 1)
      )
      and (
        coalesce(array_length(blacklist, 1), 0) = 0
        or not exists (
          select 1
          from recipe_ingredients rib
          where rib.recipe_id = r.id
            and rib.ingredient_id = any (blacklist)
        )
      )
      and (
        requested_tag_count = 0
        -- One row per requested tag the recipe satisfies through ANY tag in
        -- that request's subtree; all of them must be satisfied.
        or (
          select count(distinct q.root_id)
          from requested_tags q
          join recipe_tags rt
            on rt.recipe_id = r.id
           and rt.tag_id = q.tag_id
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 1b. One row per dish — the copy closest to the requested difficulty.
   *
   * This is what makes an escalated variant reachable: when a dish exists at
   * both medium (base) and hard (variant) and the user asked for hard, the
   * hard row represents the family. The base only wins an exact tie, so
   * nothing changes for a dish that has no variants, and a dish still never
   * appears more than once in the feed.
   * ------------------------------------------------- */
  family_picks as (
    select distinct on (m.family_id)
      m.id,
      m.name,
      m.description,
      m.short_description,
      m.image,
      m.difficulty,
      m.favourite_count
    from matching_recipes m
    order by
      m.family_id,
      difficulty_preference_rank(m.difficulty, difficulty_filter),
      -- Equal distance: prefer the base, which carries the likes and the image.
      (m.base_recipe_id is not null),
      m.id
  ),

  /* -------------------------------------------------
   * 1c. Difficulty no longer narrows the set — it orders it, so the preferred
   * level fills the limit first and the rest is topped up by proximity.
   * ------------------------------------------------- */
  candidate_recipes as (
    select *
    from family_picks f
    order by
      difficulty_preference_rank(f.difficulty, difficulty_filter),
      f.name
    limit limit_count
  ),

  /* -------------------------------------------------
   * 2. Recipes with relations
   * ------------------------------------------------- */
  recipe_rows as (
    select
      c.id,
      c.name,
      c.description,
      c.short_description,
      c.image,
      c.difficulty,
      c.favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_ingredients ri on ri.ingredient_id = i.id
        where ri.recipe_id = c.id
      ), '[]'::jsonb) as ingredients,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', t.id, 'name', t.name)
          order by t.name
        )
        from tags t
        join recipe_tags rt on rt.tag_id = t.id
        where rt.recipe_id = c.id
      ), '[]'::jsonb) as tags,
      'recipe'::text as source
    from candidate_recipes c
  ),

  /* -------------------------------------------------
   * 3. Suggestion candidates (fallback)
   *
   * Not limited here: the outer select does the cutting, so a preferred-level
   * suggestion can still displace an off-level one further down the list.
   * ------------------------------------------------- */
  suggestion_candidates as (
    select
      rs.id,
      rs.name,
      rs.description,
      rs.difficulty::text as difficulty
    from recipe_suggestions rs
    where
      rs.canonical_id not in (
        select regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '_', 'g')
        from candidate_recipes c
      )
      and (
        coalesce(array_length(ingredients, 1), 0) = 0
        or (
          select count(distinct rsi.ingredient_id)
          from recipe_suggestion_ingredients rsi
          where rsi.recipe_suggestion_id = rs.id
            and rsi.ingredient_id = any (ingredients)
        ) = array_length(ingredients, 1)
      )
      and (
        coalesce(array_length(blacklist, 1), 0) = 0
        or not exists (
          select 1
          from recipe_suggestion_ingredients rsib
          where rsib.recipe_suggestion_id = rs.id
            and rsib.ingredient_id = any (blacklist)
        )
      )
      and (
        requested_tag_count = 0
        -- Same subtree rule as the recipe branch above.
        or (
          select count(distinct q.root_id)
          from requested_tags q
          join recipe_suggestion_tags rst
            on rst.recipe_suggestion_id = rs.id
           and rst.tag_id = q.tag_id
        ) = requested_tag_count
      )
  ),

  /* -------------------------------------------------
   * 4. Suggestions with relations
   * ------------------------------------------------- */
  suggestion_rows as (
    select
      sc.id,
      sc.name,
      sc.description,
      -- Already a single generated line: it is its own short form.
      sc.description as short_description,
      null::text as image,
      sc.difficulty,
      0 as favourite_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', i.id, 'name', i.name)
          order by i.name
        )
        from ingredients i
        join recipe_suggestion_ingredients rsi
          on rsi.ingredient_id = i.id
        where rsi.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as ingredients,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', t.id, 'name', t.name)
          order by t.name
        )
        from tags t
        join recipe_suggestion_tags rst
          on rst.tag_id = t.id
        where rst.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as tags,
      'suggestion'::text as source
    from suggestion_candidates sc
  ),

  /* -------------------------------------------------
   * 5. Combine and enforce limit
   * ------------------------------------------------- */
  combined as (
    select * from recipe_rows
    union all
    select * from suggestion_rows
  )

-- Every column is alias-qualified: `ingredients` and `tags` are also parameter
-- names on this function, so a bare column list here is ambiguous. The previous
-- version only avoided that by selecting `*`, which cannot carry an ORDER BY.
select
  c.id,
  c.name,
  c.description,
  c.short_description,
  c.image,
  c.difficulty,
  c.favourite_count,
  c.ingredients,
  c.tags,
  c.source
from combined c
-- Real recipes before suggestions, then closest-to-preference, then by name.
order by
  case c.source when 'recipe' then 0 else 1 end,
  difficulty_preference_rank(c.difficulty, difficulty_filter),
  c.name
limit limit_count;

end;
$function$;
