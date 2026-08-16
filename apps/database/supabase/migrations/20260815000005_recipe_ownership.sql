-- Who a recipe belongs to — the column `origin` was scaffolding for.
--
-- `20260815000003` landed provenance (`recipes.origin`) and said the import work
-- was a feature rather than another schema migration. It was half right: the
-- column says a user brought the dish in, but not WHICH user, and every read
-- path in this schema was written against a catalogue with no owner at all. An
-- imported recipe is a photograph of somebody's cookbook page. It is theirs.
--
-- ## The ownership model, in one sentence
--
-- `created_by IS NULL` means the shared catalogue; a non-null `created_by` means
-- exactly one profile can see it. That is the whole rule, and it is written once
-- as `recipe_is_visible(uuid)` below because it now has to hold in four places
-- (this table's RLS, its three child tables, `find_recipes`, `search_recipes`)
-- and a divergence between any two of them is a silent leak rather than an
-- error.
--
-- NULL rather than "the system profile" or a boolean `is_private`, because:
--
--   * every existing row is correctly labelled with no backfill — the catalogue
--     is, and remains, unowned;
--   * `created_by is null` is exactly the predicate the feed already wants, so
--     the hot path stays a null test on an indexed-by-absence column rather than
--     a join;
--   * a second flag would be a second thing to keep in step with `origin`, and
--     two provenance columns that can disagree is the failure this schema
--     already learned about from `is_generated`.
--
-- ## Imported implies owned, enforced
--
-- `recipes_imported_has_owner` makes the direction that matters true by
-- construction: an `origin = 'imported'` row with no owner is rejected at write
-- time. Every consumer downstream may therefore scope on `created_by` ALONE and
-- never has to also test `origin` — which is the difference between one
-- predicate repeated four times and two predicates that have to agree.
--
-- The converse is deliberately NOT constrained. `created_by` on a generated row
-- is not a contradiction, it is the shape a future "my private variant" feature
-- would take, and nothing today writes it.
--
-- ## What this migration does NOT change
--
-- Generated recipes. Every one of them keeps `created_by IS NULL`, stays
-- world-readable to `anon` and `authenticated`, and flows through `find_recipes`
-- exactly as before. `modify` and `escalate` still write shared variants — that
-- is today's behaviour and this is not the change that revisits it.

------------------------------------------------------------------------------
-- 1. The column
------------------------------------------------------------------------------

alter table recipes
    add column if not exists created_by uuid references profiles (id) on delete cascade;

comment on column recipes.created_by is
    'Owning profile, or NULL for the shared catalogue. Non-null means exactly one profile may read the row (see recipe_is_visible). Required when origin = ''imported''.';

-- Partial for the same reason `idx_recipes_origin_imported` is: the catalogue is
-- the overwhelming majority and no query asks for "the unowned ones" by index —
-- they are found by the absence test, which needs no index. What DOES need one
-- is "this profile's recipes", and that is the rows this covers.
create index if not exists idx_recipes_created_by
    on recipes using btree (created_by)
    where (created_by is not null);

alter table recipes
    drop constraint if exists recipes_imported_has_owner;

alter table recipes
    add constraint recipes_imported_has_owner
        check (origin <> 'imported' or created_by is not null);

------------------------------------------------------------------------------
-- 2. The visibility rule, written once
------------------------------------------------------------------------------
--
-- Plain SQL and `stable`, so the planner inlines it into the policies and into
-- `find_recipes` rather than calling it per row — the same reason
-- `current_profile_id()` (20260815000004) is shaped this way.
--
-- SECURITY INVOKER (the default) throughout. This is a convenience for
-- expressing the rule, never the thing that enforces it: RLS enforces it on the
-- tables, and `find_recipes` — which is SECURITY DEFINER and so sees past RLS
-- entirely — has to apply it in its own WHERE clause. That asymmetry is the
-- whole reason section 4 exists.

create or replace function public.recipe_is_visible(p_created_by uuid)
    returns boolean
    language sql
    stable
as $function$
select p_created_by is null
    or p_created_by = current_profile_id();
$function$;

comment on function public.recipe_is_visible(uuid) is
    'The one recipe visibility rule: unowned rows are the shared catalogue, owned rows belong to one profile. Used by the recipes RLS policies AND by find_recipes/search_recipes, which are SECURITY DEFINER and must apply it themselves.';

------------------------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------------------------
--
-- `public_read on recipes` has been `using (true)` since the baseline —
-- `20260812000000` narrowed the ROLES it applies to and deliberately left the
-- predicate alone, on the stated grounds that "the catalog is a shared,
-- unattributed corpus with no owner column". That premise is what section 1
-- retires.
--
-- ## The child tables are not optional
--
-- Hiding the `recipes` row alone hides the dish's name and image and leaves its
-- ingredients, its steps and its tags readable by anyone holding the id — which
-- is the entire content of the thing being protected. `recipe_ingredients`,
-- `recipe_instructions` and `recipe_tags` therefore resolve visibility through
-- their parent.
--
-- The `exists` costs a primary-key lookup per row on the DIRECT table reads the
-- client makes (`use-recipe`, `use-recipes`, `use-popular-recipes`). It does not
-- touch the feed: `find_recipes` is SECURITY DEFINER and never consults a policy
-- at all, which is exactly why it needs its own filter in the next migration.
--
-- Note the subquery is itself subject to `recipes`' policy, so a hidden parent
-- yields `not exists` even before `recipe_is_visible` is evaluated. The call is
-- kept anyway: a child table's rule should say what it is, not inherit it from
-- whichever policy happens to be on the parent this week.

alter policy public_read on recipes
    using (recipe_is_visible(created_by));

alter policy public_read on recipe_ingredients
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_ingredients.recipe_id
                     and recipe_is_visible(r.created_by)));

alter policy public_read on recipe_instructions
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_instructions.recipe_id
                     and recipe_is_visible(r.created_by)));

alter policy public_read on recipe_tags
    using (exists (select 1
                   from recipes r
                   where r.id = recipe_tags.recipe_id
                     and recipe_is_visible(r.created_by)));

-- KNOWN AND ACCEPTED: `recipe_display_tags` and `recipe_dietary` are views
-- created without `security_invoker`, so they run as their owner and see past
-- the policies above. What they expose for an owned recipe is its TAG NAMES
-- keyed by an id the reader must already hold — not the recipe, its ingredients
-- or its steps. Flipping them to `security_invoker` is a behaviour change for
-- every existing caller (including `find_recipes`, which reads them from inside
-- its own definer context) and belongs in its own migration, not smuggled into
-- this one.

------------------------------------------------------------------------------
-- 4. The catalogue's uniqueness constraint stops applying to owned rows
------------------------------------------------------------------------------
--
-- `recipes_dish_identity_difficulty_unique` (20260812000003) says one canonical
-- dish per cuisine per difficulty among BASE recipes. That is a statement about
-- the CATALOGUE — it is what stops promotion writing a second "Lasagna" row —
-- and an import is not a catalogue entry.
--
-- Without this, the first user to photograph a lasagna recipe gets a row and
-- every user after them gets a unique-violation on a dish the catalogue already
-- knows, which is both wrong and unfixable from the client. Two people owning
-- their own copy of the same dish is the normal case for user-authored content,
-- not a duplicate.
--
-- Strictly weaker than what it replaces (it removes rows from the index's
-- predicate), so it cannot fail on existing data — every row today has
-- `created_by IS NULL`.

drop index if exists recipes_dish_identity_difficulty_unique;

create unique index recipes_dish_identity_difficulty_unique
    on recipes using btree (canonical_id, identity_cuisine, difficulty)
    nulls not distinct
    where (base_recipe_id is null and created_by is null);

------------------------------------------------------------------------------
-- 5. persist_recipe_with_ingredient_ids learns who is writing
------------------------------------------------------------------------------
--
-- `p_created_by` is APPENDED and defaults to NULL, so every existing positional
-- call keeps meaning what it meant and keeps writing what it wrote.
--
-- ## Only this one, and not `persist_recipe`
--
-- The import path resolves its ingredients through `matchIngredients` — the TS
-- pipeline with the gray-band creation gate, alias learning and LLM categories —
-- and therefore arrives here holding ingredient UUIDs. It is the only writer
-- that will ever pass an owner. Adding the parameter to `persist_recipe` as well
-- would be a second 150-line function body reproduced, and a second overload to
-- drop, in service of no caller. Add it there when something needs it; the
-- shapes are identical and the diff is this section.
--
-- Body reproduced from the live definition (`pg_get_functiondef`), which is
-- `20260815000003`'s. Two edits, both marked in place.

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

-- The 19-argument predecessor from 20260815000003. Types only, and exactly
-- nineteen of them.
drop function if exists public.persist_recipe_with_ingredient_ids(
    text, text, difficulty_type, integer, text, text, integer, integer, integer,
    integer, text[], text, jsonb, jsonb, text[], text, text, uuid, text);

-- Assert the postcondition rather than trusting the drop. PostgREST
-- disambiguates overloads on argument NAMES, so a leftover sibling does not
-- fail — it silently wins whichever call omits the new parameter.
do $$
declare
    v_count integer;
begin
    select count(*)
    into v_count
    from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'persist_recipe_with_ingredient_ids';

    if v_count <> 1 then
        raise exception 'expected exactly 1 persist_recipe_with_ingredient_ids, found %', v_count;
    end if;
end;
$$;

notify pgrst, 'reload schema';
