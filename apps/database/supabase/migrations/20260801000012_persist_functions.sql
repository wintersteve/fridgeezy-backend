-- Persist RPCs: the transactional writes behind recipe generation and
-- suggestion streaming. Each one inserts a parent row plus all of its children
-- in a single call, so a half-written recipe is impossible.
--
-- persist_recipe computes an ingredient's canonical_id with
-- ingredient_canonical_id() — which singularises — and relies on
-- ON CONFLICT (canonical_id) to reuse an existing row. At the time of this
-- baseline the BEFORE INSERT trigger overwrote that value with a
-- non-singularising rule, so the conflict target never saw the singular form
-- and plural spellings produced duplicate ingredients. 20260801000016 makes the
-- trigger defer to the same helper, so the two now agree and this function
-- needs no change.

create or replace function public.persist_suggestion(p_name text, p_description text, p_difficulty difficulty_type,
                                                     p_ingredient_ids uuid[], p_tag_ids uuid[], p_embedding vector,
                                                     p_name_en text default null::text)
    returns uuid
    language plpgsql
as $function$
declare
    v_suggestion_id uuid;
    v_ingredient_id uuid;
    v_tag_id        uuid;
begin
    insert into recipe_suggestions (name, description, difficulty, name_en, embedding)
    values (p_name, p_description, p_difficulty, p_name_en, p_embedding)
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

-- Takes ingredients by NAME and resolves (or creates) them. Used by the
-- generation path, where the model returns names rather than ids.
create or replace function public.persist_recipe(p_name text, p_description text, p_difficulty difficulty_type,
                                                 p_servings integer, p_prep_time text, p_cook_time text,
                                                 p_kcal integer, p_carbs integer, p_protein integer, p_fat integer,
                                                 p_tips text[], p_image text, p_ingredients jsonb,
                                                 p_instructions jsonb, p_tags text[],
                                                 p_name_en text default null::text,
                                                 p_base_recipe_id uuid default null::uuid)
    returns uuid
    language plpgsql
as $function$
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
    -- Insert recipe and get ID
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, base_recipe_id, is_generated)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, p_base_recipe_id, true)
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
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, ingredient_refs)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            v_ingredient_refs
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

-- Takes ingredients by ID. Used by the suggestion-promotion path, where
-- ingredients were already resolved and matched while the suggestion was
-- persisted — so this one never creates ingredients and never touches
-- categories, and is not subject to the canonical_id defect described above.
--
-- Only the 16-argument form survives the consolidation. The live database also
-- carries a 15-argument overload (no p_name_en) that no caller uses; keeping
-- both leaves PostgREST to disambiguate on argument names, which is exactly how
-- the legacy persist_recipe overload came to be dropped in 20260731000009.
create or replace function public.persist_recipe_with_ingredient_ids(p_name text, p_description text,
                                                                     p_difficulty difficulty_type, p_servings integer,
                                                                     p_prep_time text, p_cook_time text, p_kcal integer,
                                                                     p_carbs integer, p_protein integer, p_fat integer,
                                                                     p_tips text[], p_image text, p_ingredients jsonb,
                                                                     p_instructions jsonb, p_tags text[],
                                                                     p_name_en text default null::text)
    returns uuid
    language plpgsql
as $function$
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
    -- Insert recipe and get ID
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, true)
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
        INSERT INTO recipe_instructions (recipe_id, step_number, instruction_text, ingredient_refs)
        VALUES (
            v_recipe_id,
            v_step_number,
            v_instruction->>'text',
            v_ingredient_refs
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
