-- Derive a recipe's dietary status from its ingredients, and make find_recipes
-- filter on that instead of on what the model claimed.
--
-- THREE-VALUED, FAILING CLOSED
-- A recipe is free of something only when EVERY ingredient is classified and
-- none carries the property. An unclassified ingredient makes the answer
-- unknown, and unknown does not qualify. The alternative — treating unclassified
-- as safe — would hand a user with a nut allergy a dish nobody has checked.
--
-- The cost of that choice is honest and visible: until ingredients are
-- classified, a dietary filter returns nothing from the catalogue and
-- `shouldUseAI` takes over, where the restriction is already honoured in the
-- prompt. It also produces a free work queue — the unclassified ingredients
-- blocking the most recipes are the ones worth classifying first.

-- Which properties disqualify a dish from each diet. A table rather than a CASE
-- buried in the function: it is reference data, it is what makes the properties
-- reusable, and adding or loosening a diet is then an INSERT, not a migration
-- that rewrites find_recipes.
create table if not exists dietary_rules
(
    -- Matches tags.canonical_id for the dietary tag of the same name, which is
    -- how a requested tag is recognised as derivable.
    diet_canonical_id text primary key,
    forbidden         dietary_property[] not null,
    constraint dietary_rules_forbidden_not_empty check (cardinality(forbidden) > 0)
);

comment on table dietary_rules is
    'Diets that can be derived from ingredient properties. A dietary tag absent from this table falls back to the model-assigned recipe_tags.';

insert into dietary_rules (diet_canonical_id, forbidden)
values ('vegan', '{meat,fish,shellfish,dairy,egg,honey,slaughter_derived}'),
       -- Vegetarians eat dairy, egg and honey; only the flesh and the
       -- slaughter-derived additives are out.
       ('vegetarian', '{meat,fish,shellfish,slaughter_derived}'),
       ('pescatarian', '{meat,slaughter_derived}'),
       ('dairy_free', '{dairy}'),
       ('egg_free', '{egg}'),
       ('gluten_free', '{gluten}'),
       ('nut_free', '{nuts}'),
       ('soy_free', '{soy}'),
       ('shellfish_free', '{shellfish}'),
       ('paleo', '{grain,legume,dairy,refined_sugar}')
on conflict (diet_canonical_id) do update set forbidden = excluded.forbidden;

-- Deliberately NOT here, and why:
--   halal, kosher            depend on slaughter method and certification
--   keto, low_carb, low_fat,
--   low_sodium, high_protein quantitative — need per-ingredient nutrition and
--                            the recipe's amounts; `ingredients.nutritional_info`
--                            is still empty
--   flexitarian              not a restriction anything can be filtered against
-- All eight keep their existing behaviour: matched against recipe_tags.

-- One row per (recipe, diet) the recipe QUALIFIES for.
--
-- A view, not a materialized one: correctness is automatic, there are no
-- refresh triggers to forget, and reclassifying an ingredient takes effect
-- immediately. At this scale the aggregate is trivial; if it ever stops being
-- trivial, materializing it is a local change behind the same name.
create or replace view recipe_dietary as
select r.id as recipe_id,
       d.diet_canonical_id
from recipes r
         cross join dietary_rules d
-- A recipe with no ingredient rows tells us nothing, so it qualifies for
-- nothing. Without this it would vacuously satisfy every diet.
where exists (select 1
              from recipe_ingredients ri
              where ri.recipe_id = r.id)
  and not exists (select 1
                  from recipe_ingredients ri
                           join ingredients i on i.id = ri.ingredient_id
                  where ri.recipe_id = r.id
                    -- Unclassified and disqualifying are the same answer here:
                    -- both mean "cannot promise this dish is free of it".
                    and (i.dietary_classified_at is null
                      or i.dietary_properties && d.forbidden));

create or replace view recipe_suggestion_dietary as
select s.id as recipe_suggestion_id,
       d.diet_canonical_id
from recipe_suggestions s
         cross join dietary_rules d
where exists (select 1
              from recipe_suggestion_ingredients rsi
              where rsi.recipe_suggestion_id = s.id)
  and not exists (select 1
                  from recipe_suggestion_ingredients rsi
                           join ingredients i on i.id = rsi.ingredient_id
                  where rsi.recipe_suggestion_id = s.id
                    and (i.dietary_classified_at is null
                      or i.dietary_properties && d.forbidden));

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
  -- Counted off the raw argument, not off the resolved `requested` CTE below,
  -- so an id that matches no tag row makes the filter unsatisfiable instead of
  -- being quietly ignored. For a restriction, failing closed is the only safe
  -- direction.
  requested_tag_count integer := (select count(distinct t) from unnest(tags) as t);
begin
  -- Normalize difficulty preference
  if
coalesce(p_difficulty, '') <> '' then
    difficulty_filter := p_difficulty;
end if;

return query with
  /* -------------------------------------------------
   * 0a. Each requested tag, resolved, and how it must be satisfied: a derivable
   * diet is answered from the ingredients, everything else from the tags the
   * row carries.
   * ------------------------------------------------- */
  requested as (
    select distinct
      t.id,
      t.canonical_id,
      (dr.diet_canonical_id is not null) as is_derived_diet
    from unnest(tags) as req(id)
    join tags t on t.id = req.id
    left join dietary_rules dr
      on t.type = 'dietary'
     and dr.diet_canonical_id = t.canonical_id
  ),

  /* -------------------------------------------------
   * 0b. Subtree expansion for the tag-matched ones (see 20260803000002).
   * ------------------------------------------------- */
  requested_tags as (
    select s.root_id, s.tag_id
    from tag_subtree(array(select id from requested where not is_derived_diet)) s
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
        -- Every requested tag must be satisfied, each by its own rule.
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_dietary rd
                where rd.recipe_id = r.id
                  and rd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_tags rt
                  on rt.recipe_id = r.id
                 and rt.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
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
        -- Same two rules as the recipe branch.
        or (
          select count(*)
          from requested q
          where
            case
              when q.is_derived_diet then exists (
                select 1
                from recipe_suggestion_dietary rsd
                where rsd.recipe_suggestion_id = rs.id
                  and rsd.diet_canonical_id = q.canonical_id
              )
              else exists (
                select 1
                from requested_tags s
                join recipe_suggestion_tags rst
                  on rst.recipe_suggestion_id = rs.id
                 and rst.tag_id = s.tag_id
                where s.root_id = q.id
              )
            end
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
