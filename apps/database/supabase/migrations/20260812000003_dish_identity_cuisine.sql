-- Dish identity becomes (canonical name, identity cuisine).
--
-- ## The defect
--
-- `recipe_suggestions.canonical_id` was unique OUTRIGHT, so two genuinely
-- different dishes that share a name could not both exist: Turkish Mantı (beef,
-- garlic yogurt) and Kazakh Manti (lamb and pumpkin, steamed), Spanish tortilla
-- (potato omelette) and Mexican tortilla (flatbread), Greek moussaka and
-- Levantine moussaka.
--
-- And it failed worse than a merge. `persistOrReuseSuggestion` calls
-- `findKnownDish` at step 0 — before the authenticity review — which does exact
-- `canonical_id` equality and returns the stored row with NO LLM, NO embedding
-- and NO adjudication. The second dish was not merged into the first, it was
-- silently REPLACED by it: a user filtering cuisine=kazakh was handed a Turkish
-- dish, and Kazakh Manti was permanently unreachable.
--
-- ## Why the disambiguator cannot live in the name
--
-- It currently tries to. `DISH_NAME_RULE` keeps a qualifier that "marks a
-- genuinely different dish" — "Lao Green Papaya Salad", "Hiroshima-style
-- Okonomiyaki" — and for those it works, because the qualifier is intrinsic to
-- how the variant is described. It cannot work in general: naming is a
-- STATELESS, per-dish decision made by a gate that has never seen the other row,
-- while disambiguation is inherently RELATIONAL.
--
-- Measured 2026-08-12 over two runs of `dedup-authenticity`, the gate named 3 of
-- 5 homographs apart unaided — and did so STOCHASTICALLY. Moussaka collided on
-- one run and came back "Maghmour" on the next. A disambiguator that answers
-- differently on Tuesday is not one: the dish named apart on Monday collides the
-- next day, and the collision replaces a row with nothing logged.
--
-- ## Why two columns rather than `turkish__manti`
--
-- `findKnownDish` is a single indexed lookup that skips a review measured at 77%
-- of a four-card batch's token cost. A concatenated key turns "does any Manti
-- exist?" into a prefix scan, and needs a normalised cuisine BEFORE the review
-- has produced one. Keeping the name its own indexed column leaves that lookup
-- exactly as it is — it just returns 0..N rows instead of 0-or-1, and the
-- cuisine picks among them.
--
-- ## What this does NOT need, and why
--
-- Measured before writing any of it (`calibrate-thresholds`, `dedup-authenticity`):
--
--   homographs      0.741 - 0.846   all below SIGNATURE_HIGH_THRESHOLD (0.92)
--   cuisine drift   0.906 - 0.946   all above SIGNATURE_LOW_THRESHOLD (0.75)
--
-- The two distributions do not overlap, and the adjudicator then kept 5/5
-- homographs apart and merged 4/4 drift pairs, deterministically. So the read
-- path only has to STOP SHORT-CIRCUITING on a cuisine-incompatible name hit and
-- fall through to the signature layer that already exists. No new adjudication
-- call site, no authenticity-gate prompt change, no threshold move.
--
-- ## The zero-row diagnostic is not evidence this was unnecessary
--
-- Querying for rows that collide today returns nothing, and must: the unique
-- constraint means the second Manti was never written. **The rows that prove
-- the defect are exactly the rows that do not exist.** Only instrumentation at
-- the moment `findKnownDish` returns can count them.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

alter table recipe_suggestions
    add column if not exists identity_cuisine text;

alter table recipes
    add column if not exists identity_cuisine text;

comment on column recipe_suggestions.identity_cuisine is
    'canonical_id of the ONE cuisine that is part of this dish''s identity. '
        'Neither generated nor trigger-stamped, and it cannot be: cuisine lives in '
        'recipe_suggestion_tags, which persist_suggestion writes AFTER this row '
        'exists, so a BEFORE INSERT trigger would see no tags. Written by the RPC. '
        'NULL means UNKNOWN, and the unique constraint below is NULLS NOT DISTINCT '
        'so unknown collides with unknown — i.e. exactly the old behaviour for any '
        'row without a cuisine.';

comment on column recipes.identity_cuisine is
    'See recipe_suggestions.identity_cuisine. Copied onto variants too, even '
        'though the partial unique index below only covers base recipes, so reads '
        'do not have to special-case them.';

-- Shape only. Deliberately NOT a foreign key to tags(canonical_id), even though
-- tags_canonical_id_unique would permit one: persist_recipe resolves tags INSIDE
-- the function and RAISE WARNINGs on an unmatched one, so an FK would turn a
-- skippable tag miss into an aborted recipe insert. Verified against the live
-- vocabulary — 0 of 172 cuisine tags have a canonical_id that fails this.
alter table recipe_suggestions
    add constraint recipe_suggestions_identity_cuisine_canonical
        check (identity_cuisine is null
            or identity_cuisine = normalize_to_canonical_id(identity_cuisine));

alter table recipes
    add constraint recipes_identity_cuisine_canonical
        check (identity_cuisine is null
            or identity_cuisine = normalize_to_canonical_id(identity_cuisine));

------------------------------------------------------------------------------
-- 2. Backfill — before the constraints, so they are built on final values
------------------------------------------------------------------------------
--
-- Pick rule: the DEEPEST cuisine tag in the tree, ties broken by canonical_id.
-- Deepest maximises identity discrimination and is what the generator prompt
-- already asks for ("as specific as you can be"). The tie-break is arbitrary but
-- DETERMINISTIC, which is what matters — a non-deterministic pick would make
-- `db reset` produce a different database each time.
--
-- Empirically moot on the current catalogue (0 rows carry two cuisine tags), but
-- it has to be written for the future and for genuine fusion dishes.
--
-- A row with no cuisine tag is left NULL, which merges. Filling those needs an
-- LLM and belongs in operations/, shaped like backfill-course-tags.

with recursive cuisine_depth as (
    -- Anchored on the five KNOWN continental roots rather than on
    -- `parent_id is null`, because matchTags creates cuisines at runtime and a
    -- failed parent lookup leaves one orphaned at the top. Two already exist
    -- (`jewish`, `lithuanian`), and treating those as roots would rate them the
    -- LEAST specific tag on the row when they are in fact the most.
    select t.id, t.canonical_id, 0 as lvl
    from tags t
    where t.type = 'cuisine'
      and t.canonical_id in ('asian', 'european', 'african', 'americas', 'oceania')
    union all
    select t.id, t.canonical_id, d.lvl + 1
    from tags t
             join cuisine_depth d on t.parent_id = d.id
    -- Depth guard, not decoration. The tree is seeded three deep, but nothing
    -- ENFORCES acyclicity and matchTags writes new rows into it at runtime;
    -- carrying `lvl` means a cycle would generate distinct tuples forever rather
    -- than being absorbed by UNION the way tag_subtree's is.
    where t.type = 'cuisine'
      and d.lvl < 10
),
     depth as (
         select t.id, t.canonical_id, coalesce(cd.lvl, 99) as lvl
         from tags t
                  left join cuisine_depth cd on cd.id = t.id
         where t.type = 'cuisine'
     ),
     pick as (
         select distinct on (rst.recipe_suggestion_id) rst.recipe_suggestion_id as row_id,
                                                       d.canonical_id
         from recipe_suggestion_tags rst
                  join depth d on d.id = rst.tag_id
         order by rst.recipe_suggestion_id, d.lvl desc, d.canonical_id
     )
update recipe_suggestions rs
set identity_cuisine = pick.canonical_id
from pick
where pick.row_id = rs.id;

with recursive cuisine_depth as (
    select t.id, t.canonical_id, 0 as lvl
    from tags t
    where t.type = 'cuisine'
      and t.canonical_id in ('asian', 'european', 'african', 'americas', 'oceania')
    union all
    select t.id, t.canonical_id, d.lvl + 1
    from tags t
             join cuisine_depth d on t.parent_id = d.id
    where t.type = 'cuisine'
      and d.lvl < 10
),
     depth as (
         select t.id, t.canonical_id, coalesce(cd.lvl, 99) as lvl
         from tags t
                  left join cuisine_depth cd on cd.id = t.id
         where t.type = 'cuisine'
     ),
     pick as (
         select distinct on (rt.recipe_id) rt.recipe_id as row_id,
                                           d.canonical_id
         from recipe_tags rt
                  join depth d on d.id = rt.tag_id
         order by rt.recipe_id, d.lvl desc, d.canonical_id
     )
update recipes r
set identity_cuisine = pick.canonical_id
from pick
where pick.row_id = r.id;

-- A variant inherits its base's identity. It sits outside the partial index
-- below either way, but a NULL here would make reads special-case variants.
update recipes v
set identity_cuisine = b.identity_cuisine
from recipes b
where v.base_recipe_id = b.id
  and v.identity_cuisine is distinct from b.identity_cuisine;

------------------------------------------------------------------------------
-- 3. Identity constraints
------------------------------------------------------------------------------
--
-- Both are strictly WEAKER than what they replace, so neither can fail on
-- existing data. NULLS NOT DISTINCT needs PG15+; the linked project is 17.6,
-- local is 17.4, config.toml pins major_version = 17.

alter table recipe_suggestions
    drop constraint if exists recipe_suggestions_canonical_id_unique;

alter table recipe_suggestions
    add constraint recipe_suggestions_dish_identity_unique
        unique nulls not distinct (canonical_id, identity_cuisine);

-- idx_recipe_suggestions_canonical_id is deliberately KEPT. It is what holds the
-- name-only lookup to a single index scan returning 0..N candidates, which is
-- the whole reason identity is two columns rather than one composite string.
-- (The new constraint's index has canonical_id as its leading column and could
-- serve that too; dropping the standalone one is a separate, later decision.)

drop index if exists recipes_canonical_id_difficulty_unique;

-- NULLS NOT DISTINCT also widens the meaning of a null `difficulty`, which the
-- old index left as "always distinct". Verified a no-op today: 0 recipes and 0
-- suggestions have a null difficulty.
create unique index recipes_dish_identity_difficulty_unique
    on recipes using btree (canonical_id, identity_cuisine, difficulty)
    nulls not distinct
    where (base_recipe_id is null);

------------------------------------------------------------------------------
-- 4. Persist RPCs
------------------------------------------------------------------------------
--
-- DROPPED and recreated, not `create or replace`d. Adding a defaulted parameter
-- to an existing function creates an OVERLOAD rather than replacing it, and
-- PostgREST disambiguates on argument NAMES — which is exactly how the legacy
-- persist_recipe overload came to be dropped in 20260801000012.
--
-- The bodies below are reproduced from the LIVE definitions
-- (`pg_get_functiondef`), not from 20260801000012: persist_recipe and
-- persist_recipe_with_ingredient_ids have each been redefined three times since,
-- most recently by 20260803000012_instruction_equipment.sql. Recreating them
-- from the original file would have silently reverted instruction durations,
-- temperatures and equipment.
--
-- The only change to each body is threading p_identity_cuisine into its INSERT.
-- It goes in the INSERT rather than a follow-up UPDATE deliberately: a base
-- recipe committed with a NULL identity_cuisine is, to the index above, a second
-- base under the base's identity, and a failed follow-up would leave a permanent
-- duplicate that nothing collapses.

drop function if exists public.persist_suggestion(text, text, difficulty_type, uuid[], uuid[], vector, text);

drop function if exists public.persist_recipe(text, text, difficulty_type, integer, text, text, integer,
    integer, integer, integer, text[], text, jsonb, jsonb, text[], text, uuid);

drop function if exists public.persist_recipe_with_ingredient_ids(text, text, difficulty_type, integer, text,
    text, integer, integer, integer, integer, text[], text, jsonb, jsonb, text[], text);

CREATE OR REPLACE FUNCTION public.persist_suggestion(p_name text, p_description text, p_difficulty difficulty_type, p_ingredient_ids uuid[], p_tag_ids uuid[], p_embedding vector, p_name_en text DEFAULT NULL::text, p_identity_cuisine text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
    v_suggestion_id uuid;
    v_ingredient_id uuid;
    v_tag_id        uuid;
begin
    insert into recipe_suggestions (name, description, difficulty, name_en, embedding, identity_cuisine)
    values (p_name, p_description, p_difficulty, p_name_en, p_embedding, p_identity_cuisine)
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
    -- Insert recipe and get ID
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, base_recipe_id, is_generated, identity_cuisine)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, p_base_recipe_id, true, p_identity_cuisine)
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
    -- Insert recipe and get ID
    INSERT INTO recipes (name, description, difficulty, servings, prep_time, cook_time, kcal, carbs, protein, fat, tips, image, name_en, is_generated, identity_cuisine)
    VALUES (p_name, p_description, p_difficulty, p_servings, p_prep_time, p_cook_time, p_kcal, p_carbs, p_protein, p_fat, p_tips, p_image, p_name_en, true, p_identity_cuisine)
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
-- 5. find_recipes — the read-side twin
------------------------------------------------------------------------------
--
-- Based on 20260812000001_find_recipes_tag_type.sql's body, NOT on the newest
-- committed version. That file is a `create or replace` of the whole function,
-- so rebasing onto 20260807000001 would replay last on a `db reset` and silently
-- drop `type` from the tags aggregate again — which `recipe-card.tsx` reads to
-- find the cuisine chip, so the label would just stop rendering.
--
-- Two changes: `identity_cuisine` threaded through matching_recipes and
-- family_picks (candidate_recipes is `select *`), and the suggestion
-- suppression predicate keyed on the pair. Both are commented in place.

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
      m.identity_cuisine
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
      'recipe'::text as source
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
      rs.difficulty::text as difficulty
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
      'suggestion'::text as source
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
  c.source
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
--
-- The three RPCs were dropped and recreated, so a cached schema would keep
-- offering the old argument lists until the connection pool recycled.

notify pgrst, 'reload schema';
