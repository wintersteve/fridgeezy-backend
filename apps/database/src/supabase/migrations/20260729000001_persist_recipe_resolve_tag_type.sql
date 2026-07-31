-- Tags are a CLOSED, curated vocabulary spanning four types, and the recipe
-- prompt is handed the whole list (fetch-recipe-metadata -> formatTagsForPrompt).
-- But both persist functions resolved every tag name like this:
--
--     INSERT INTO tags (canonical_id, name, type)
--     VALUES (v_canonical_id, v_tag_name, 'cuisine')
--     ON CONFLICT (name, type) DO UPDATE ...
--
-- Type hardcoded to 'cuisine', conflict target (name, type). So when the LLM
-- correctly returned `vegetarian` — which already exists as type `dietary` —
-- it did NOT conflict, and a SECOND tag named "vegetarian" typed cuisine was
-- created and linked instead. Every dietary/course/component tag a recipe ever
-- earned was silently rewritten into a cuisine-typed duplicate.
--
-- The damage, measured before this migration: 39 recipe_tags rows, of which 29
-- pointed at 8 mistyped twins (vegetarian, vegan, gluten free, dairy free,
-- dish, main, dessert, sauce). Zero recipes carried a correctly-typed dietary,
-- course or component tag — which is why the home screen's quick-filter chips
-- matched suggestions only and never a real recipe. The suggestion path was
-- always fine: it goes through matchTags() (canonical lookup -> vector search),
-- which respects types.
--
-- Fix: resolve the name to an EXISTING tag and never create one. An unmatched
-- tag is dropped with a warning rather than invented — better an under-tagged
-- recipe than a poisoned vocabulary, and the prompt already constrains output
-- to the real list.
--
-- Ordering matters below: the twins are merged FIRST, so the canonical_id
-- lookup the new function bodies rely on is unambiguous, and so the unique
-- index that keeps it that way can be created at all.

-- ---------------------------------------------------------------------------
-- 1. Merge the mistyped cuisine twins into their correctly-typed originals.
-- ---------------------------------------------------------------------------
-- Every FK into tags is ON DELETE CASCADE, so the referencing rows have to be
-- repointed before the twin is dropped or they vanish with it. Each repoint is
-- guarded against colliding with a row that already points at the good tag,
-- because both junction tables carry a (parent, tag_id) unique constraint.
do $$
declare
    twin RECORD;
    moved INT;
begin
    for twin in
        select bad.id as bad_id, good.id as good_id,
               bad.name as name, good.type as good_type
        from tags bad
        join tags good
          on good.canonical_id = bad.canonical_id
         and good.id <> bad.id
         and good.type <> 'cuisine'
        where bad.type = 'cuisine'
    loop
        update recipe_tags rt
           set tag_id = twin.good_id
         where rt.tag_id = twin.bad_id
           and not exists (
               select 1 from recipe_tags x
                where x.recipe_id = rt.recipe_id
                  and x.tag_id = twin.good_id
           );
        get diagnostics moved = ROW_COUNT;
        delete from recipe_tags where tag_id = twin.bad_id;

        update recipe_suggestion_tags rst
           set tag_id = twin.good_id
         where rst.tag_id = twin.bad_id
           and not exists (
               select 1 from recipe_suggestion_tags x
                where x.recipe_suggestion_id = rst.recipe_suggestion_id
                  and x.tag_id = twin.good_id
           );
        delete from recipe_suggestion_tags where tag_id = twin.bad_id;

        update profile_dietary_preferences pdp
           set tag_id = twin.good_id
         where pdp.tag_id = twin.bad_id
           and not exists (
               select 1 from profile_dietary_preferences x
                where x.profile_id = pdp.profile_id
                  and x.tag_id = twin.good_id
           );
        delete from profile_dietary_preferences where tag_id = twin.bad_id;

        update tag_aliases ta
           set tag_id = twin.good_id, type = twin.good_type
         where ta.tag_id = twin.bad_id
           and not exists (
               select 1 from tag_aliases x
                where x.alias = ta.alias
                  and x.type = twin.good_type
           );
        delete from tag_aliases where tag_id = twin.bad_id;

        -- parent_id is ON DELETE SET NULL, so a child would be orphaned rather
        -- than deleted. None exist today; reparent defensively anyway.
        update tags set parent_id = twin.good_id where parent_id = twin.bad_id;

        delete from tags where id = twin.bad_id;

        raise notice 'Merged mistyped cuisine tag "%" into % (% recipe links moved)',
            twin.name, twin.good_type, moved;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Stop the duplicates coming back.
-- ---------------------------------------------------------------------------
-- Only (name, type) was unique, which is exactly what let "vegetarian" exist
-- twice under two types. canonical_id is the key everything actually resolves
-- on — persist_recipe below, matchTags() app-side, the tag_aliases lookup — so
-- it is the one that has to be unique. This also blocks matchTags() step 3
-- (auto-create unmatched cuisine tags) from re-creating a twin of an existing
-- dietary/course/component tag; that insert now fails, and the caller already
-- handles a failed create by logging and treating the tag as unmatched.
create unique index if not exists tags_canonical_id_unique on tags (canonical_id);

-- ---------------------------------------------------------------------------
-- 3. persist_recipe — resolve tags, never create them.
-- ---------------------------------------------------------------------------
-- Body is identical to 20260727000004 apart from the tag block.
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

-- ---------------------------------------------------------------------------
-- 4. persist_recipe_with_ingredient_ids — same tag block.
-- ---------------------------------------------------------------------------
-- Body is identical to 20260727000002 apart from the tag block. The two
-- functions have drifted in every other respect (this one takes ingredient
-- UUIDs directly and does no category resolution), so they stay separate.
create or replace function persist_recipe_with_ingredient_ids(
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
$$ language plpgsql;
