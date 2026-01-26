-- Update persist_recipe function to handle comment field in ingredients
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
    p_tags TEXT[]
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
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image)
    RETURNING id INTO v_recipe_id;

    -- Process ingredients
    FOR v_ingredient IN SELECT * FROM jsonb_array_elements(p_ingredients)
    LOOP
        -- Get or create category
        INSERT INTO categories (name)
        VALUES (v_ingredient->>'category')
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_category_id;

        -- Get or create ingredient
        v_canonical_id := normalize_to_canonical_id(v_ingredient->>'name');

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
                v_canonical_id := normalize_to_canonical_id(v_ingredient_name);

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

    -- Process tags
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
        v_canonical_id := normalize_to_canonical_id(v_tag_name);

        -- Get or create tag (default to cuisine type)
        INSERT INTO tags (canonical_id, name, type)
        VALUES (v_canonical_id, v_tag_name, 'cuisine')
        ON CONFLICT (name, type) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
        RETURNING id INTO v_tag_id;

        -- Insert recipe_tag
        INSERT INTO recipe_tags (recipe_id, tag_id)
        VALUES (v_recipe_id, v_tag_id)
        ON CONFLICT (recipe_id, tag_id) DO NOTHING;
    END LOOP;

    RETURN v_recipe_id;
end;
$$ language plpgsql;

COMMENT on function persist_recipe is
'Atomically persists a complete recipe with all related entities (ingredients, instructions, tags).
Uses transactions to ensure all-or-nothing persistence.

Parameters:
- p_name: Recipe name
- p_description: Recipe description
- p_difficulty: Difficulty level (easy, medium, hard)
- p_servings: Number of servings
- p_prep_time: Preparation time as text (e.g., "15 min")
- p_cook_time: Cooking time as text (e.g., "30 min")
- p_kcal: Calories per serving
- p_carbs: Carbohydrates in grams per serving
- p_protein: Protein in grams per serving
- p_fat: Fat in grams per serving
- p_tips: Array of cooking tips
- p_image: Image URL
- p_ingredients: JSONB array of ingredients [{name, category, parent, quantity, unit, comment}]
- p_instructions: JSONB array of instructions [{text, ingredients}]
- p_tags: Array of tag names

Returns:
- UUID of the created recipe

Behavior:
- Creates new ingredients/categories/tags if they don''t exist (upsert)
- Requires units to be pre-seeded (fails if unit not found)
- Normalizes all names to canonical_id format for matching
- Maps instruction ingredient names to UUIDs
- Stores optional comment field for recipe-specific ingredient preparation notes
- Defaults all tags to "cuisine" type
- Entire operation is atomic (rolls back on any error)
';
