-- Categories are a CLOSED, curated set (the 20 seeded rows). But persist_recipe
-- (the recipe-variant path: modify-recipe / escalate-difficulty) took the recipe
-- LLM's free-text `category` string and CREATED a category row for it on the fly
-- (INSERT ... ON CONFLICT). The generator emits ad-hoc singular labels ("meat",
-- "spice", "oil"), so this quietly proliferated junk categories alongside the
-- curated set (Meats/Herbs & Spices/Fats & Oils).
--
-- Fix: resolve the provided category to an EXISTING category by canonical_id and
-- never create one. If it doesn't resolve, leave category_id NULL (the column is
-- nullable) rather than polluting the vocabulary — far better an uncategorised
-- new ingredient than an ad-hoc category. The recipe-generation prompt is
-- constrained to the 20 category ids in the same change, so NULL is a rare
-- last resort.
--
-- Body is otherwise identical to 20260730000001 (ingredient_canonical_id for the
-- ingredient creation + instruction lookup; tags unchanged).
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
    p_name_en TEXT default null
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
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, true)
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

-- Clean up any ad-hoc categories the old behaviour already created: fold each
-- non-seeded category into its seeded counterpart where the singular label maps
-- to a seeded one, then null out the rest so no ingredient points at a junk
-- category. Seeded categories all have a description; the ad-hoc ones don't.
do $$
declare
    junk RECORD;
    target_id UUID;
    singular_to_seeded JSONB := '{
        "meat": "meats", "poultry": "meats", "seafood": "seafood",
        "egg": "eggs", "dairy": "dairy", "vegetable": "vegetables",
        "fruit": "fruits", "grain": "grains", "legume": "legumes",
        "nut": "nuts_seeds", "seed": "nuts_seeds", "mushroom": "mushrooms",
        "noodle": "noodles", "bread": "breads", "oil": "fats_oils",
        "fat": "fats_oils", "sweetener": "sweeteners", "stock": "stocks",
        "sauce": "sauces", "condiment": "sauces", "vinegar": "vinegars",
        "beverage": "beverages", "herb": "herbs_spices", "spice": "herbs_spices"
    }'::jsonb;
begin
    for junk in
        select id, canonical_id from categories where description is null
    loop
        target_id := null;
        if singular_to_seeded ? junk.canonical_id then
            select id into target_id from categories
             where canonical_id = singular_to_seeded->>junk.canonical_id;
        end if;

        if target_id is not null then
            update ingredients set category_id = target_id where category_id = junk.id;
        else
            update ingredients set category_id = null where category_id = junk.id;
        end if;

        delete from categories where id = junk.id;
    end loop;
end $$;
