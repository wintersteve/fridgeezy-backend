-- `persist_recipe_with_ingredient_ids` learns `p_base_recipe_id`.
--
-- ## The gap
--
-- Two persist RPCs write recipes, and only one of them could write a VARIANT.
-- `persist_recipe` (ingredients by name) has taken `p_base_recipe_id` since the
-- baseline, which is what lets modify and escalate store their output as a
-- variant of the dish it came from. `persist_recipe_with_ingredient_ids`
-- (ingredients already resolved to ids — the promotion path) never had one, so
-- anything that path produced could only ever be a BASE row.
--
-- That is not a cosmetic asymmetry. The promotion path is where an adapted
-- recipe is now written from — a user whose blacklist the catalogue copy
-- violates gets their own version generated — and without this parameter the
-- only two outcomes were "serve the catalogue copy the user cannot eat" or
-- "insert a second base row under the same name", which
-- `recipes_canonical_id_difficulty_unique` rejects outright.
--
-- ## Why the parameter and not a follow-up UPDATE
--
-- The same reason `persist_recipe` takes one, recorded on
-- `RecipesRepository.persist`: a row that exists even briefly with a null
-- `base_recipe_id` is, to the partial unique index, a second base recipe under
-- the base's name. There is no window in which to re-parent it — the INSERT is
-- what fails. The parent has to be in the INSERT.
--
-- ## Overloads
--
-- `create or replace function` with a changed argument list creates a SECOND
-- function rather than replacing the first, and PostgREST then disambiguates on
-- argument NAMES — so a call omitting `p_base_recipe_id` would be ambiguous
-- between the 17- and 18-argument forms. The 17-argument one is dropped
-- explicitly and the postcondition asserted, exactly as `20260812000005` had to
-- do after the last time this was missed.
--
-- Body reproduced from the live definition (`pg_get_functiondef`), which is
-- 20260812000004's verbatim. Two edits, both marked in place.

CREATE OR REPLACE FUNCTION public.persist_recipe_with_ingredient_ids(p_name text, p_description text, p_difficulty difficulty_type, p_servings integer, p_prep_time text, p_cook_time text, p_kcal integer, p_carbs integer, p_protein integer, p_fat integer, p_tips text[], p_image text, p_ingredients jsonb, p_instructions jsonb, p_tags text[], p_name_en text DEFAULT NULL::text, p_identity_cuisine text DEFAULT NULL::text, p_base_recipe_id uuid DEFAULT NULL::uuid)
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
    --
    -- (1/2) `base_recipe_id` joins the column list, and the INSERT is the only
    -- place it may be set — see the header.
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated, identity_cuisine, total_time_minutes, base_recipe_id)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, true, p_identity_cuisine,
            nullif(
                coalesce(minutes_from_time_text(p_prep_time), 0)
                    + coalesce(minutes_from_time_text(p_cook_time), 0),
                0
            ),
            -- (2/2)
            p_base_recipe_id)
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

-- The 17-argument predecessor. Types only, and exactly seventeen of them — the
-- new function takes eighteen, so this cannot match it.
drop function if exists public.persist_recipe_with_ingredient_ids(
    text, text, difficulty_type, integer, text, text, integer, integer, integer,
    integer, text[], text, jsonb, jsonb, text[], text, text);

-- Assert the postcondition rather than trusting the drop.
do $$
declare
    v_count integer;
begin
    select count(*) into v_count
    from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'persist_recipe_with_ingredient_ids';

    if v_count <> 1 then
        raise exception
            'expected exactly 1 persist_recipe_with_ingredient_ids, found %', v_count;
    end if;
end;
$$;

notify pgrst, 'reload schema';
