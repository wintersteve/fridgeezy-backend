-- How long a dish takes, as one number, on both sides of promotion.
--
-- ## The defect
--
-- Every card in the app showed a cook time that was INVENTED. The client's
-- `getRecipeMeta` hashed the card's id into 10-60 minutes in steps of 5 — the
-- hash existed only so the lie stayed stable between renders — and its own file
-- header said "MOCK DATA - remove once the backend supplies this".
--
-- Meanwhile `recipes.prep_time` / `cook_time` were real, were SELECTED by the
-- client's `use-recipe` and `use-recipes` hooks, and were rendered by nothing.
-- So the app fetched the true times, discarded them, and drew a fabricated one
-- next to them.
--
-- `recipe_suggestions` had no time column at all, so a suggestion card had
-- nothing to show even in principle. That is the half users actually reported:
-- a card promising "35 min" opens onto a recipe of 20 prep + 55 cook. The two
-- were never in disagreement — they were never connected.
--
-- ## Why a total, and why an integer
--
-- One number, in minutes, on both tables. The client bands it into quick /
-- moderate / long (`timeBandFor` in @fridgeezy/schemas) and renders a pill
-- beside the difficulty one.
--
-- The BAND is not stored, deliberately. Storing minutes keeps the thresholds a
-- product decision that can move in a client release, rather than a value baked
-- into every row that would need a backfill to retune. Minutes also give the
-- promote prompt a concrete anchor ("about 45 minutes") where a band would only
-- give it a range.
--
-- ## Why recipes DERIVE it rather than taking it as a parameter
--
-- `persist_recipe` computes `total_time_minutes` from `p_prep_time` and
-- `p_cook_time` inside the same INSERT that writes them. It is deliberately NOT
-- a parameter: a caller that could pass its own total is a caller that can pass
-- one disagreeing with the two columns beside it, which is the exact class of
-- bug being closed here. Derived in the INSERT, the pill on the card cannot
-- contradict the times on the detail screen, because both come from the same
-- two values.
--
-- Suggestions are the opposite case and must take a parameter: a suggestion
-- exists BEFORE its recipe does, so there is nothing to derive from. The model
-- estimates it, and `promote` feeds that estimate back into the recipe prompt so
-- the generated recipe lands in the band the card promised.
--
-- ## NULL means unknown, and stays that way
--
-- Suggestions written before this migration have no estimate and get none — a
-- backfill would have to invent the number, which is what is being removed. The
-- client renders no pill for a NULL rather than guessing a band. The check
-- constraints are `> 0` for the same reason: 0 is not "instant", it is "we do
-- not know", and it must not be storable as though it were a measurement.

------------------------------------------------------------------------------
-- 1. Parsing helper
------------------------------------------------------------------------------
--
-- `prep_time` / `cook_time` are TEXT, always written as '15 min' by
-- RecipesRepository. This exists so that format is parsed in ONE place rather
-- than three (the backfill below plus both persist RPCs).
--
-- Deliberately STRICT rather than "strip everything that is not a digit". The
-- lazy version turns '1 h 30 min' into 130, which is not merely wrong, it is
-- wrong in the direction that silently promotes a dish into the top band. Any
-- shape this does not recognise returns NULL, and a NULL total renders no pill
-- — the failure mode is a missing pill, never a confidently wrong one.

create or replace function public.minutes_from_time_text(p_value text)
    returns integer
    language sql
    immutable
    parallel safe
as
$$
select case
           when p_value ~ '^\s*[0-9]{1,4}\s*(m|min|mins|minute|minutes)?\s*$'
               then (regexp_replace(p_value, '\D', '', 'g'))::integer
           else null
           end;
$$;

comment on function public.minutes_from_time_text(text) is
    'Minutes out of a "15 min" style string, or NULL if it is not that shape. '
        'Never guesses: an unrecognised format must not become a plausible number.';

------------------------------------------------------------------------------
-- 2. Columns
------------------------------------------------------------------------------

alter table recipe_suggestions
    add column if not exists total_time_minutes integer;

alter table recipes
    add column if not exists total_time_minutes integer;

alter table recipe_suggestions
    add constraint recipe_suggestions_total_time_positive
        check (total_time_minutes is null or total_time_minutes > 0);

alter table recipes
    add constraint recipes_total_time_positive
        check (total_time_minutes is null or total_time_minutes > 0);

comment on column recipe_suggestions.total_time_minutes is
    'ESTIMATED total minutes (prep + cook) for the dish this card offers, written '
        'by the generator. An estimate of a recipe that does not exist yet, which '
        'is why the client bands it rather than printing it: three bands is about '
        'the resolution the estimate actually carries. NULL for rows written '
        'before 20260812000004 — unknown, and not backfilled, since inventing the '
        'number is the bug this replaces.';

comment on column recipes.total_time_minutes is
    'DERIVED total minutes: prep_time + cook_time, computed inside persist_recipe '
        'from the same parameters that write those two columns. Not a parameter on '
        'purpose — a caller able to pass its own total is a caller able to pass one '
        'that disagrees with the times on the detail screen.';

------------------------------------------------------------------------------
-- 3. Backfill — recipes only
------------------------------------------------------------------------------
--
-- Rows whose text does not parse are left NULL rather than defaulted, so a
-- format this does not understand shows no pill instead of a wrong one.

update recipes
set total_time_minutes = nullif(
        coalesce(minutes_from_time_text(prep_time), 0)
            + coalesce(minutes_from_time_text(cook_time), 0),
        0
                         )
where total_time_minutes is null;

------------------------------------------------------------------------------
-- 4. Persist RPCs
------------------------------------------------------------------------------
--
-- DROPPED and recreated rather than `create or replace`d, for the reason
-- 20260812000003 records: adding a defaulted parameter creates an OVERLOAD, and
-- PostgREST disambiguates on argument NAMES.
--
-- The bodies are reproduced from the LIVE definitions (`pg_get_functiondef`),
-- verified byte-identical to 20260812000003 before editing. Rebuilding them from
-- an older file would silently revert instruction durations, temperatures,
-- equipment and identity_cuisine.
--
-- persist_suggestion GAINS a parameter (nothing to derive from); the two recipe
-- functions gain none and compute the total in their INSERT instead.

drop function if exists public.persist_suggestion(text, text, difficulty_type, uuid[], uuid[], vector, text, text);

drop function if exists public.persist_recipe(text, text, difficulty_type, integer, text, text, integer,
    integer, integer, integer, text[], text, jsonb, jsonb, text[], text, uuid, text);

drop function if exists public.persist_recipe_with_ingredient_ids(text, text, difficulty_type, integer, text,
    text, integer, integer, integer, integer, text[], text, jsonb, jsonb, text[], text, text);

CREATE OR REPLACE FUNCTION public.persist_suggestion(p_name text, p_description text, p_difficulty difficulty_type, p_ingredient_ids uuid[], p_tag_ids uuid[], p_embedding vector, p_name_en text DEFAULT NULL::text, p_identity_cuisine text DEFAULT NULL::text, p_total_time_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
    v_suggestion_id uuid;
    v_ingredient_id uuid;
    v_tag_id        uuid;
begin
    insert into recipe_suggestions (name, description, difficulty, name_en, embedding, identity_cuisine,
                                    total_time_minutes)
    values (p_name, p_description, p_difficulty, p_name_en, p_embedding, p_identity_cuisine,
            -- Folded to NULL rather than trusted: the check constraint rejects 0
            -- and a non-positive estimate is the model failing to answer, not a
            -- dish that takes no time.
            nullif(greatest(coalesce(p_total_time_minutes, 0), 0), 0))
    returning id into v_suggestion_id;

    foreach v_ingredient_id in array p_ingredient_ids
        loop
            insert into recipe_suggestion_ingredients (recipe_suggestion_id, ingredient_id)
            values (v_suggestion_id, v_ingredient_id)
            on conflict (recipe_suggestion_id, ingredient_id) do nothing;
        end loop;

    foreach v_tag_id in array p_tag_ids
        loop
            insert into recipe_suggestion_tags (recipe_suggestion_id, tag_id)
            values (v_suggestion_id, v_tag_id)
            on conflict (recipe_suggestion_id, tag_id) do nothing;
        end loop;

    return v_suggestion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.persist_recipe(p_name text, p_description text, p_difficulty difficulty_type, p_servings integer, p_prep_time text, p_cook_time text, p_kcal integer, p_carbs integer, p_protein integer, p_fat integer, p_tips text[], p_image text, p_ingredients jsonb, p_instructions jsonb, p_tags text[], p_name_en text DEFAULT NULL::text, p_base_recipe_id uuid DEFAULT NULL::uuid, p_identity_cuisine text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
    v_recipe_id UUID;
    v_ingredient JSONB;
    v_instruction JSONB;
    v_tag_name TEXT;
    v_ingredient_id UUID;
    v_category_id UUID;
    v_unit_id UUID;
    v_tag_id UUID;
    v_canonical_id TEXT;
    v_step_number INT;
    v_ingredient_refs UUID[];
    v_ingredient_name TEXT;
    v_comment TEXT;
begin
    -- Insert recipe and get ID. `total_time_minutes` is DERIVED here from the
    -- two time parameters rather than being one of its own — see the header.
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, base_recipe_id, is_generated, identity_cuisine, total_time_minutes)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, p_base_recipe_id, true, p_identity_cuisine,
            nullif(
                coalesce(minutes_from_time_text(p_prep_time), 0)
                    + coalesce(minutes_from_time_text(p_cook_time), 0),
                0
            ))
    RETURNING id INTO v_recipe_id;

    -- Process ingredients
    FOR v_ingredient IN SELECT * FROM jsonb_array_elements(p_ingredients)
    LOOP
        -- Resolve the category to an EXISTING one (closed vocabulary). Never
        -- create a new category; leave NULL if it doesn't resolve.
        SELECT id INTO v_category_id
        FROM categories
        WHERE canonical_id = normalize_to_canonical_id(v_ingredient->>'category');

        -- Get or create ingredient (singular/plural-collapsing canonical)
        v_canonical_id := ingredient_canonical_id(v_ingredient->>'name');

        INSERT INTO ingredients (canonical_id, name, category_id)
        VALUES (v_canonical_id, v_ingredient->>'name', v_category_id)
        ON CONFLICT (canonical_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
        RETURNING id INTO v_ingredient_id;

        -- Find unit by abbreviation
        SELECT id INTO v_unit_id
        FROM units
        WHERE abbreviation = v_ingredient->>'unit'
        LIMIT 1;

        IF v_unit_id IS NULL THEN
            RAISE EXCEPTION 'Unit with abbreviation "%" not found', v_ingredient->>'unit';
        END IF;

        -- Extract comment field (may be null)
        v_comment := v_ingredient->>'comment';

        -- Insert recipe_ingredient with comment
        INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, comment)
        VALUES (
            v_recipe_id,
            v_ingredient_id,
            (v_ingredient->>'quantity')::DECIMAL,
            v_unit_id,
            v_comment
        );
    END LOOP;

    -- Process instructions
    v_step_number := 1;
    FOR v_instruction IN SELECT * FROM jsonb_array_elements(p_instructions)
    LOOP
        -- Map ingredient names to UUIDs
        v_ingredient_refs := ARRAY[]::UUID[];

        IF v_instruction->'ingredients' IS NOT NULL THEN
            FOR v_ingredient_name IN SELECT jsonb_array_elements_text(v_instruction->'ingredients')
            LOOP
                v_canonical_id := ingredient_canonical_id(v_ingredient_name);

                -- Find ingredient ID by canonical_id
                SELECT id INTO v_ingredient_id
                FROM ingredients
            WHERE canonical_id = v_canonical_id
                LIMIT 1;

                IF v_ingredient_id IS NOT NULL THEN
                    v_ingredient_refs := array_append(v_ingredient_refs, v_ingredient_id);
                END IF;
            END LOOP;
        END IF;

        -- Insert instruction
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, ingredient_refs, duration_seconds, temperature_c, equipment)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            v_ingredient_refs,
            CASE
                WHEN (v_instruction->>'duration_seconds') ~ '^[0-9]+$'
                     AND (v_instruction->>'duration_seconds')::integer > 0
                    THEN (v_instruction->>'duration_seconds')::integer
                ELSE NULL
            END,
            CASE
                WHEN (v_instruction->>'temperature_c') ~ '^-?[0-9]+$'
                     AND (v_instruction->>'temperature_c')::integer BETWEEN -40 AND 500
                    THEN (v_instruction->>'temperature_c')::integer
                ELSE NULL
            END,
            CASE
                WHEN jsonb_typeof(v_instruction->'equipment') = 'array'
                    THEN nullif(
                        ARRAY(SELECT jsonb_array_elements_text(v_instruction->'equipment')),
                        ARRAY[]::text[]
                    )
                ELSE NULL
            END
        );

        v_step_number := v_step_number + 1;
    END LOOP;

    -- Process tags: resolve to an existing tag of ANY type, keeping the type
    -- the curated vocabulary assigned. Falls back to tag_aliases so alternate
    -- spellings ("gluten-free", "no dairy") still land on the canonical tag.
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
        v_canonical_id := normalize_to_canonical_id(trim(v_tag_name));

        SELECT id INTO v_tag_id
        FROM tags
        WHERE canonical_id = v_canonical_id;

        IF v_tag_id IS NULL THEN
            SELECT tag_id INTO v_tag_id
            FROM tag_aliases
            WHERE canonical_id = v_canonical_id
            LIMIT 1;
        END IF;

        IF v_tag_id IS NULL THEN
            RAISE WARNING 'persist_recipe: no tag matches "%" (recipe "%") - skipped',
                v_tag_name, p_name;
        ELSE
            INSERT INTO recipe_tags (recipe_id, tag_id)
            VALUES (v_recipe_id, v_tag_id)
            ON CONFLICT (recipe_id, tag_id) DO NOTHING;
        END IF;
    END LOOP;

    RETURN v_recipe_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.persist_recipe_with_ingredient_ids(p_name text, p_description text, p_difficulty difficulty_type, p_servings integer, p_prep_time text, p_cook_time text, p_kcal integer, p_carbs integer, p_protein integer, p_fat integer, p_tips text[], p_image text, p_ingredients jsonb, p_instructions jsonb, p_tags text[], p_name_en text DEFAULT NULL::text, p_identity_cuisine text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
    v_recipe_id UUID;
    v_ingredient JSONB;
    v_instruction JSONB;
    v_tag_name TEXT;
    v_ingredient_id UUID;
    v_unit_id UUID;
    v_tag_id UUID;
    v_canonical_id TEXT;
    v_step_number INT;
    v_ingredient_refs UUID[];
    v_ref_id TEXT;
    v_comment TEXT;
begin
    -- Insert recipe and get ID. See persist_recipe for why the total is derived
    -- here rather than passed in.
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated, identity_cuisine, total_time_minutes)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, true, p_identity_cuisine,
            nullif(
                coalesce(minutes_from_time_text(p_prep_time), 0)
                    + coalesce(minutes_from_time_text(p_cook_time), 0),
                0
            ))
    RETURNING id INTO v_recipe_id;

    -- Process ingredients using ingredient_id directly
    FOR v_ingredient IN SELECT * FROM jsonb_array_elements(p_ingredients)
    LOOP
        -- Get ingredient_id directly from input (no lookup needed)
        v_ingredient_id := (v_ingredient->>'ingredient_id')::UUID;

        -- Validate ingredient exists
        IF v_ingredient_id IS NULL THEN
            RAISE EXCEPTION 'Ingredient ID is null for ingredient in recipe "%"', p_name;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM ingredients WHERE id = v_ingredient_id) THEN
            RAISE EXCEPTION 'Ingredient with ID "%" not found', v_ingredient_id;
        END IF;

        -- Find unit by abbreviation
        SELECT id INTO v_unit_id
        FROM units
        WHERE abbreviation = v_ingredient->>'unit'
        LIMIT 1;

        IF v_unit_id IS NULL THEN
            RAISE EXCEPTION 'Unit with abbreviation "%" not found', v_ingredient->>'unit';
        END IF;

        -- Extract comment field (may be null)
        v_comment := v_ingredient->>'comment';

        -- Insert recipe_ingredient with comment
        INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, comment)
        VALUES (
            v_recipe_id,
            v_ingredient_id,
            (v_ingredient->>'quantity')::DECIMAL,
            v_unit_id,
            v_comment
        );
    END LOOP;

    -- Process instructions using ingredient_ids directly (UUIDs, no name lookup)
    v_step_number := 1;
    FOR v_instruction IN SELECT * FROM jsonb_array_elements(p_instructions)
    LOOP
        -- Get ingredient_ids directly from input
        v_ingredient_refs := ARRAY[]::UUID[];

        IF v_instruction->'ingredient_ids' IS NOT NULL THEN
            FOR v_ref_id IN SELECT jsonb_array_elements_text(v_instruction->'ingredient_ids')
            LOOP
                v_ingredient_refs := array_append(v_ingredient_refs, v_ref_id::UUID);
            END LOOP;
        END IF;

        -- Insert instruction
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, ingredient_refs, duration_seconds, temperature_c, equipment)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            v_ingredient_refs,
            CASE
                WHEN (v_instruction->>'duration_seconds') ~ '^[0-9]+$'
                     AND (v_instruction->>'duration_seconds')::integer > 0
                    THEN (v_instruction->>'duration_seconds')::integer
                ELSE NULL
            END,
            CASE
                WHEN (v_instruction->>'temperature_c') ~ '^-?[0-9]+$'
                     AND (v_instruction->>'temperature_c')::integer BETWEEN -40 AND 500
                    THEN (v_instruction->>'temperature_c')::integer
                ELSE NULL
            END,
            CASE
                WHEN jsonb_typeof(v_instruction->'equipment') = 'array'
                    THEN nullif(
                        ARRAY(SELECT jsonb_array_elements_text(v_instruction->'equipment')),
                        ARRAY[]::text[]
                    )
                ELSE NULL
            END
        );

        v_step_number := v_step_number + 1;
    END LOOP;

    -- Process tags: see persist_recipe above.
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
        v_canonical_id := normalize_to_canonical_id(trim(v_tag_name));

        SELECT id INTO v_tag_id
        FROM tags
        WHERE canonical_id = v_canonical_id;

        IF v_tag_id IS NULL THEN
            SELECT tag_id INTO v_tag_id
            FROM tag_aliases
            WHERE canonical_id = v_canonical_id
            LIMIT 1;
        END IF;

        IF v_tag_id IS NULL THEN
            RAISE WARNING 'persist_recipe_with_ingredient_ids: no tag matches "%" (recipe "%") - skipped',
                v_tag_name, p_name;
        ELSE
            INSERT INTO recipe_tags (recipe_id, tag_id)
            VALUES (v_recipe_id, v_tag_id)
            ON CONFLICT (recipe_id, tag_id) DO NOTHING;
        END IF;
    END LOOP;

    RETURN v_recipe_id;
end;
$function$;

------------------------------------------------------------------------------
-- 5. find_recipes — the read side
------------------------------------------------------------------------------
--
-- The home feed reads through this RPC and nothing else, so without threading
-- the column through here a saved recipe would show no pill while the suggestion
-- that produced it showed one.
--
-- The function is DROPPED first so the composite type can take a new attribute
-- with no dependency to argue about, then recreated. `add attribute` appends at
-- the END, so `total_time_minutes` must be the LAST column of every branch of
-- the union and of the final select — a mismatch here is a runtime "returned
-- record does not match" per row, not a build error.
--
-- Body reproduced from the live definition, which is 20260812000003's verbatim.
-- Six edits, all marked in place, all of them threading one column.

drop function if exists public.find_recipes(text, uuid[], uuid[], uuid[], integer, integer);

alter type find_recipes_result
    add attribute total_time_minutes integer;

create or replace function public.find_recipes(p_difficulty text default null::text,
                                               ingredients uuid[] default array []::uuid[],
                                               tags uuid[] default array []::uuid[],
                                               blacklist uuid[] default array []::uuid[],
                                               limit_count integer default 10,
                                               p_offset integer default 0)
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
      r.identity_cuisine,
      -- (1/6) The time band's only input.
      r.total_time_minutes,
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
   * Note the band travels WITH the difficulty pick rather than being read
   * separately: an easy and a hard copy of one dish have different times, and
   * the pill has to describe the copy actually being shown.
   * ------------------------------------------------- */
  family_picks as (
    select distinct on (m.family_id)
      m.id,
      m.name,
      m.description,
      m.short_description,
      m.image,
      m.difficulty,
      m.favourite_count,
      m.identity_cuisine,
      -- (2/6)
      m.total_time_minutes
    from matching_recipes m
    order by
      m.family_id,
      difficulty_preference_rank(m.difficulty, difficulty_filter),
      -- Equal distance: prefer the base, which carries the likes and the image.
      (m.base_recipe_id is not null),
      m.id
  ),

  /* -------------------------------------------------
   * 1c. Difficulty orders rather than narrows.
   * ------------------------------------------------- */
  candidate_recipes as (
    select *
    from family_picks f
    order by
      difficulty_preference_rank(f.difficulty, difficulty_filter),
      f.name
    -- Must cover the whole requested WINDOW, not just its length. This is a
    -- performance guard — `recipe_rows` below runs two jsonb aggregates per row,
    -- so the pool is cut before that rather than after — and it was written when
    -- there was only ever one page, where `limit_count` was the window.
    --
    -- With an offset it silently truncated the catalogue: at limit 12 offset 12
    -- this produced the FIRST 12 recipes, the final OFFSET then skipped all of
    -- them, and page two opened on suggestions while recipes 13+ were
    -- unreachable at any offset. Recipes must be exhausted before a suggestion
    -- is shown, and that is exactly what broke.
    limit limit_count + greatest(p_offset, 0)
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
      -- Display tags, not raw recipe_tags: a dietary chip now says what the
      -- ingredients say, which is what the filter above answered from.
      -- `type` included so the client can single out the cuisine tag (or any
      -- other type) without name-matching.
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_display_tags dt
        where dt.recipe_id = c.id
      ), '[]'::jsonb) as tags,
      'recipe'::text as source,
      -- (3/6) LAST, matching the attribute just appended to the result type.
      c.total_time_minutes
    from candidate_recipes c
  ),

  /* -------------------------------------------------
   * 3. Suggestion candidates (fallback)
   * ------------------------------------------------- */
  suggestion_candidates as (
    select
      rs.id,
      rs.name,
      rs.description,
      rs.difficulty::text as difficulty,
      -- (4/6) The generator's estimate. NULL on anything written before
      -- 20260812000004, which the client renders as no pill.
      rs.total_time_minutes
    from recipe_suggestions rs
    where
      -- A promoted dish hides its own stale suggestion row. Keyed on
      -- (canonical name, identity cuisine) since 20260812000003: on the name
      -- alone, a promoted Turkish Manti RECIPE permanently hid a Kazakh Manti
      -- SUGGESTION from the feed, which would have undone the write-side split
      -- one layer further out.
      --
      -- `not exists`, not `not in`: `identity_cuisine` is nullable, and a single
      -- NULL anywhere in a `not in` subquery makes the whole predicate NULL and
      -- silently suppresses EVERY suggestion.
      --
      -- Null on either side merges, matching the write path — it is "unknown",
      -- not a distinct identity, so an un-backfilled row keeps behaving exactly
      -- as it does today. Ancestor-related cuisines are deliberately NOT
      -- resolved here: that needs a recursive subtree walk per row, and the
      -- write path already collapses those before two rows can exist.
      not exists (
        select 1
        from candidate_recipes c
        where regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '_', 'g') = rs.canonical_id
          and (
            c.identity_cuisine is null
            or rs.identity_cuisine is null
            or c.identity_cuisine = rs.identity_cuisine
          )
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
          jsonb_build_object('id', dt.id, 'name', dt.name, 'type', dt.type)
          order by dt.name
        )
        from recipe_suggestion_display_tags dt
        where dt.recipe_suggestion_id = sc.id
      ), '[]'::jsonb) as tags,
      'suggestion'::text as source,
      -- (5/6) LAST, and in the same position as recipe_rows above — the union
      -- below matches on position, not on name.
      sc.total_time_minutes
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
-- names on this function, so a bare column list here is ambiguous.
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
  c.source,
  -- (6/6)
  c.total_time_minutes
from combined c
-- Real recipes before suggestions, then closest-to-preference, then most
-- liked, then by name.
order by
  case c.source when 'recipe' then 0 else 1 end,
  difficulty_preference_rank(c.difficulty, difficulty_filter),
  -- The only signal of "best" this schema has. Below the difficulty tier
  -- because skill level is a stated preference and a like count is inferred
  -- taste; a hard dish should not outrank an easy one for a beginner just for
  -- being popular.
  --
  -- Only ever separates RECIPES: `suggestion_rows` reports 0 for every
  -- suggestion (nothing can favourite one), and they already sit in the lower
  -- source tier, so this cannot reorder them among themselves.
  c.favourite_count desc,
  c.name,
  -- Total order, which OFFSET pagination requires and the first three keys do
  -- not give: two difficulties of one dish share a name, and can tie on the
  -- preference rank too (easy and hard sit the same distance from medium). Any
  -- tie there lets a row shift between pages and be served twice or skipped.
  c.id
limit limit_count offset greatest(p_offset, 0);

end;
$function$;

------------------------------------------------------------------------------
-- 6. Tell PostgREST about the new signatures
------------------------------------------------------------------------------

notify pgrst, 'reload schema';
