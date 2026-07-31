-- Ingredients were being persisted in both singular and plural form (e.g.
-- "apple" AND "apples"). The suggestion path dedups via vector + LLM, but that
-- can't see an uncommitted sibling, so concurrent generation (or a single recipe
-- listing both forms) races two creates through; and the recipe-variant path
-- (persist_recipe) creates ingredients by EXACT canonical only, with no semantic
-- dedup at all. Different canonical_ids ("apple" vs "apples") never collide.
--
-- Fix: fold singular/plural into the INGREDIENT canonical_id. With "apple" and
-- "apples" mapping to the same canonical, the existing UNIQUE(canonical_id) makes
-- a duplicate physically impossible on every path (TS match, concurrent race,
-- and the persist_recipe RPC), and the conflict-safe create reuses the winner.
--
-- Scope: ingredients only. Recipe and tag names keep normalize_to_canonical_id
-- (singularizing a dish/tag name would be wrong).

-- Conservative singularizer for a single lowercase [a-z0-9] token. Deliberately
-- under-merges rather than over-merges (e.g. "leaves" -> "leave", which does not
-- collide with "leaf"): a missed merge is caught later by the vector/LLM layer or
-- the dedupe-ingredients sweep, but a wrong merge is unrecoverable. MUST stay
-- identical to the TS toIngredientCanonicalId in match-ingredients.ts.
create or replace function singularize_token(tok TEXT)
returns TEXT as $$
begin
    if length(tok) <= 3 then
        return tok;
    end if;
    -- berries -> berry, cherries -> cherry
    if tok ~ 'ies$' and length(tok) > 4 then
        return left(tok, length(tok) - 3) || 'y';
    end if;
    -- tomatoes -> tomato, boxes -> box, dishes -> dish, peaches -> peach
    if tok ~ '(oes|ses|xes|zes|ches|shes)$' then
        return left(tok, length(tok) - 2);
    end if;
    -- apples -> apple, olives -> olive; but NOT ss/us/is (glass, asparagus, basis)
    if tok ~ 's$' and tok !~ '(ss|us|is)$' then
        return left(tok, length(tok) - 1);
    end if;
    return tok;
end;
$$ language plpgsql immutable;

comment on function singularize_token is
'Conservative singularizer for one canonical token. Kept in sync with the TS singularizeToken in match-ingredients.ts.';

-- Ingredient canonical_id = normalized slug with its LAST token singularized
-- (the head noun in English: "green apples" -> "green_apple").
create or replace function ingredient_canonical_id(input_text TEXT)
returns TEXT as $$
declare
    base TEXT;
    parts TEXT[];
    last_idx INT;
begin
    base := trim(both '_' from normalize_to_canonical_id(input_text));
    if base = '' then
        return base;
    end if;
    parts := string_to_array(base, '_');
    last_idx := array_length(parts, 1);
    parts[last_idx] := singularize_token(parts[last_idx]);
    return array_to_string(parts, '_');
end;
$$ language plpgsql immutable;

comment on function ingredient_canonical_id is
'Ingredient-specific canonical_id: normalize_to_canonical_id with the last token singularized so singular/plural collapse. Kept in sync with the TS toIngredientCanonicalId in match-ingredients.ts.';

-- Backfill: collapse existing singular/plural duplicates, then recanonicalize.
-- Merge colliding rows into the oldest via merge_ingredient (repoints every
-- reference + records the merged name as an alias), THEN rewrite canonical_id to
-- the new singularized form (safe once collisions are gone).
do $$
declare
    grp RECORD;
    keeper UUID;
    i INT;
begin
    for grp in
        select ingredient_canonical_id(name) as cid,
               array_agg(id order by created_at) as ids
          from ingredients
         group by ingredient_canonical_id(name)
        having count(*) > 1
    loop
        keeper := grp.ids[1];
        for i in 2 .. array_length(grp.ids, 1) loop
            perform merge_ingredient(grp.ids[i], keeper);
        end loop;
    end loop;

    update ingredients
       set canonical_id = ingredient_canonical_id(name)
     where canonical_id is distinct from ingredient_canonical_id(name);
end $$;

-- Re-declare persist_recipe (name-lookup path) to canonicalize INGREDIENTS with
-- ingredient_canonical_id (creation + instruction lookup). Tags/categories are
-- unchanged. Body otherwise identical to 20260727000004.
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
        -- Get or create category. Conflict on canonical_id (set by trigger from
        -- name) so case/punctuation variants resolve to the existing row rather
        -- than violating categories_canonical_id_key. Keep the stored name.
        INSERT INTO categories (name)
        VALUES (v_ingredient->>'category')
        ON CONFLICT (canonical_id) DO UPDATE SET name = categories.name
        RETURNING id INTO v_category_id;

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
