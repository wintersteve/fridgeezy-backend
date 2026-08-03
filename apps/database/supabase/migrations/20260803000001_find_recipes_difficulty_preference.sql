-- Make find_recipes treat difficulty as a preference instead of a hard filter.
--
-- THE PROBLEM
-- `p_difficulty` was applied as strict equality on both branches, so a user set
-- to easy or hard saw only dishes at exactly that level. The catalogue is
-- overwhelmingly medium (at the time of writing: 3 base recipes, all medium; 19
-- of 23 suggestions medium), so honouring the client's skill setting through a
-- strict filter hands most users a completely EMPTY home feed. Difficulty is a
-- skill preference, not a constraint like a dietary restriction or a blacklist —
-- an off-level dish is a worse match, not a wrong answer.
--
-- THE FIX
-- Rank by distance from the preferred level and let `limit_count` do the
-- cutting. Exact matches always sort first, so other levels only reach the
-- result set when the preferred level cannot fill the limit — the fallback
-- tightens by itself as the catalogue fills in, with no client-side "is it
-- empty?" retry. Cards already render a difficulty dot, so what fills the tail
-- is visible to the user.
--
-- Recipes still outrank suggestions: the previous behaviour relied on UNION ALL
-- happening to emit the recipe branch first, which is incidental rather than
-- guaranteed. Now that the final select is ordered anyway, that precedence is
-- stated explicitly.

-- Distance from `pref`, with the easier level winning an equal-distance tie:
-- filling a hard cook's feed with medium beats reaching further to easy, and an
-- easy cook is topped up with medium before hard. Doubling the distance leaves
-- room for the +1 that pushes the harder side of each tie behind the easier one.
--
--   pref easy   → easy 0, medium 3, hard 5
--   pref medium → medium 0, easy 2, hard 3
--   pref hard   → hard 0, medium 2, easy 4
--
-- No preference ranks everything equally, which preserves the plain
-- alphabetical order the function had before. An unrecognised or null
-- difficulty sorts last rather than being dropped.
create or replace function public.difficulty_preference_rank(difficulty text,
                                                             pref text)
    returns integer
    language sql
    immutable
    parallel safe
as $function$
select case
           when coalesce(pref, '') = '' then 0
           when difficulty is null then 9
           else (
               select case
                          when d is null or p is null then 9
                          else abs(d - p) * 2 + case when d > p then 1 else 0 end
                      end
               from (
                        select case difficulty
                                   when 'easy' then 1
                                   when 'medium' then 2
                                   when 'hard' then 3
                                   end as d,
                               case pref
                                   when 'easy' then 1
                                   when 'medium' then 2
                                   when 'hard' then 3
                                   end as p
                    ) levels
           )
           end;
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
begin
  -- Normalize difficulty preference
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
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
        coalesce(array_length(tags, 1), 0) = 0
        or (
          select count(distinct rt.tag_id)
          from recipe_tags rt
          where rt.recipe_id = r.id
            and rt.tag_id = any (tags)
        ) = array_length(tags, 1)
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
        coalesce(array_length(tags, 1), 0) = 0
        or (
          select count(distinct rst.tag_id)
          from recipe_suggestion_tags rst
          where rst.recipe_suggestion_id = rs.id
            and rst.tag_id = any (tags)
        ) = array_length(tags, 1)
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
