-- A short headline for each step — "Blanch the pork ribs" over an instruction
-- that opens "Bring 2.5 l water to a rolling boil in a large pot".
--
-- Nullable, no default, no check. Every one of the rows written before this
-- lands has none, and nothing rewrites a step in place: `merge_recipe` touches
-- only `ingredient_refs`, there are no recipe seeds, and both persist functions
-- below only ever INSERT. So a null here is the permanent state of every
-- existing recipe until a backfill runs, and the app is built to render that as
-- exactly what it looked like before titles existed — the headline row is
-- conditional, not a fallback string.

alter table recipe_instructions add column title text;

comment on column recipe_instructions.title is
    'Short headline for the step, written by the generator alongside the text. Null on every recipe predating the field.';

-- Both persist functions restated in full with `title` added to the INSERT.
--
-- The column arrives INSIDE the existing `p_instructions` jsonb, so neither
-- signature changes — which is what keeps this off the `@fridgeezy/types`
-- tarball for the write path. They are copied verbatim from their latest
-- definitions (`persist_recipe` from 20260815000003_recipe_origin.sql,
-- `persist_recipe_with_ingredient_ids` from 20260815000005_recipe_ownership.sql)
-- with one column and one value added to each; restating rather than patching
-- is the house pattern, because plpgsql has no ALTER FUNCTION for a body.
--
-- `nullif(trim(...), '')` so a model that emits `"title": ""` stores NULL
-- rather than an empty headline the app would then render as a blank line.

CREATE OR REPLACE FUNCTION public.persist_recipe(p_name text, p_description text, p_difficulty difficulty_type, p_servings integer, p_prep_time text, p_cook_time text, p_kcal integer, p_carbs integer, p_protein integer, p_fat integer, p_tips text[], p_image text, p_ingredients jsonb, p_instructions jsonb, p_tags text[], p_name_en text DEFAULT NULL::text, p_base_recipe_id uuid DEFAULT NULL::uuid, p_identity_cuisine text DEFAULT NULL::text, p_origin text DEFAULT 'generated'::text)
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
    --
    -- (1/2) `origin` joins the column list; `is_generated` stops being a literal
    -- and becomes a function of it.
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, base_recipe_id, is_generated, identity_cuisine, total_time_minutes, origin)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, p_base_recipe_id,
            -- (2/2)
            (p_origin = 'generated'), p_identity_cuisine,
            nullif(
                coalesce(minutes_from_time_text(p_prep_time), 0)
                    + coalesce(minutes_from_time_text(p_cook_time), 0),
                0
            ),
            p_origin)
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
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, title, ingredient_refs, duration_seconds, temperature_c, equipment)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            nullif(trim(v_instruction->>'title'), ''),
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

CREATE OR REPLACE FUNCTION public.persist_recipe_with_ingredient_ids(p_name text, p_description text, p_difficulty difficulty_type, p_servings integer, p_prep_time text, p_cook_time text, p_kcal integer, p_carbs integer, p_protein integer, p_fat integer, p_tips text[], p_image text, p_ingredients jsonb, p_instructions jsonb, p_tags text[], p_name_en text DEFAULT NULL::text, p_identity_cuisine text DEFAULT NULL::text, p_base_recipe_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'generated'::text, p_created_by uuid DEFAULT NULL::uuid)
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
    -- here rather than passed in, and for why is_generated is a function of
    -- p_origin.
    --
    -- (1/2) `created_by` joins the column list...
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated, identity_cuisine, total_time_minutes, base_recipe_id, origin, created_by)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, (p_origin = 'generated'), p_identity_cuisine,
            nullif(
                coalesce(minutes_from_time_text(p_prep_time), 0)
                    + coalesce(minutes_from_time_text(p_cook_time), 0),
                0
            ),
            -- (2/2) ...and the parameter joins the values. `recipes_imported_has_owner`
            -- is what turns a caller that forgot it into a failed insert rather
            -- than an orphaned private recipe visible to everybody.
            p_base_recipe_id, p_origin, p_created_by)
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
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, title, ingredient_refs, duration_seconds, temperature_c, equipment)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            nullif(trim(v_instruction->>'title'), ''),
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

    -- Process tags: see persist_recipe.
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
