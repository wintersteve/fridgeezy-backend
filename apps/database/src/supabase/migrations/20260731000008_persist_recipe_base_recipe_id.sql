-- Give persist_recipe the variant's parent up front, so a variant row is never
-- momentarily a base row.
--
-- Until now modify-recipe and escalate-difficulty inserted the new recipe with
-- base_recipe_id NULL and called markAsVariant to re-parent it in a SEPARATE
-- statement. Between those two the row is, as far as the database is concerned,
-- a second base recipe under the base's name — which is exactly what the partial
-- unique index in 20260731000007 forbids. Escalating a dish that already had a
-- non-variant row at the target difficulty therefore failed at the INSERT, with
--   duplicate key value violates unique constraint "recipes_canonical_id_..."
-- and the row never reached markAsVariant to be excused from the index.
--
-- Passing the parent to the INSERT closes that window: the row is a variant from
-- the moment it exists, so the partial index never applies to it. Callers still
-- have to resolve the FAMILY base first (a variant of a variant points at the
-- original base, never at the intermediate) — see RecipesRepository.resolveVariantBase.
--
-- The old 16-argument signature is dropped rather than left alongside: a default
-- on the new parameter makes the two overloads ambiguous, and PostgREST refuses
-- to choose ("Could not choose the best candidate function").
--
-- Body is otherwise identical to 20260731000003.
drop function if exists persist_recipe(
    TEXT, TEXT, difficulty_type, INT, TEXT, TEXT, INT, INT, INT, INT,
    TEXT[], TEXT, JSONB, JSONB, TEXT[], TEXT
);

create or replace function persist_recipe(
    p_name TEXT,
    p_description TEXT,
    p_difficulty difficulty_type,
    p_servings INT,
    p_prep_time TEXT,
    p_cook_time TEXT,
    p_kcal INT,
    p_carbs INT,
    p_protein INT,
    p_fat INT,
    p_tips TEXT[],
    p_image TEXT,
    p_ingredients JSONB,
    p_instructions JSONB,
    p_tags TEXT[],
    p_name_en TEXT default null,
    p_base_recipe_id UUID default null
)
returns UUID as $$
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
$$ language plpgsql;
