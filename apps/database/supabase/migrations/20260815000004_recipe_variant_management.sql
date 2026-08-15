-- Variant management: rename, delete, and pin-as-default.
--
-- `recipe_variants` has existed since the baseline and holds exactly one fact —
-- "this user saved this recipe as a version of that dish" — with a `label` the
-- backend derives at creation time (`deriveLabel` in modify-recipe.ts turns
-- "make it vegetarian" into "Vegetarian"). Three things the version selector
-- needs were missing:
--
--   RENAME     — the machine label is a guess. Nothing stopped an UPDATE (the
--                `users_manage_own_recipe_variants` policy is FOR ALL), but
--                nothing constrained one either: a rename could blank the label,
--                write a paragraph into it, or — the dangerous one — repoint
--                `recipe_id` / `base_recipe_id` and detach the row from the
--                recipe it describes.
--   DELETE     — already worked, and still does through the table. What was
--                missing is what a delete has to CLEAN UP, now that a variant
--                can be pinned; see the trigger below.
--   PIN        — no way to say "when I open this dish, give me MY version".
--
-- ## Why the pin is a table and not a column on recipe_variants
--
-- Because the base itself must be pinnable. "Give me the original" is a real
-- and probably common choice, and the base has no `recipe_variants` row — it is
-- the thing variants are *of*. Representing it as one would mean a row with
-- `recipe_id = base_recipe_id`, which is precisely the corrupt shape
-- `20260815000001` was written to prevent: it is what a variant looks like after
-- it has been merged into its own base, and that migration's guard reads any
-- such row as damage. Inventing legitimate rows of exactly that shape would
-- retire the only signal there is for telling the damage apart.
--
-- So the pin gets its own table, where `recipe_id = base_recipe_id` is the
-- ordinary way of saying "the original" and carries no second meaning.
--
-- ## One default per family per profile
--
-- `unique (profile_id, base_recipe_id)` — the constraint IS the rule, rather
-- than a nullable `is_default` flag plus a partial unique index plus the
-- application remembering to clear the old one. Setting a new default is an
-- upsert on that key, so there is no window in which a family has two.

------------------------------------------------------------------------------
-- 0. Who is asking
------------------------------------------------------------------------------
--
-- Every RPC below is per-user, and the user is `auth.uid()` rather than a
-- parameter — a profile id in the signature is a profile id a caller can
-- change. SECURITY INVOKER (the default) throughout, so RLS is what actually
-- enforces the boundary and this helper is a convenience, not the gate.

create or replace function public.current_profile_id()
    returns uuid
    language sql
    stable
as $function$
select p.id
from profiles p
where p.user_id = auth.uid();
$function$;

comment on function public.current_profile_id() is
    'The calling user''s profile id, or NULL when unauthenticated. SECURITY INVOKER: reads through the users_read_own_profile policy.';

------------------------------------------------------------------------------
-- 1. recipe_variants: a label worth renaming
------------------------------------------------------------------------------

alter table recipe_variants
    add column if not exists updated_at timestamp with time zone not null default now();

-- Normalise before constraining. Existing labels come from `deriveLabel`, which
-- already caps at 40 characters, so this is expected to touch nothing — but a
-- constraint added over data that violates it fails the whole migration, and
-- "expected to touch nothing" is not the same as knowing.
update recipe_variants
set label = left(btrim(label), 80)
where label <> left(btrim(label), 80);

update recipe_variants
set label = 'Your version'
where btrim(label) = '';

alter table recipe_variants
    drop constraint if exists recipe_variants_label_check;

alter table recipe_variants
    add constraint recipe_variants_label_check
        check (char_length(btrim(label)) between 1 and 80);

-- Deliberately NOT unique per family. Two variants a user has both named
-- "Vegetarian" is confusing, not corrupt, and a rename that fails with a
-- constraint violation is worse UX than a duplicate entry in a list of three.

-- One trigger, two jobs, because both are about what an UPDATE may do.
--
-- The identity check is the load-bearing half. `users_manage_own_recipe_variants`
-- is a FOR ALL policy, so a client that can rename can also repoint — and a row
-- whose `recipe_id` has moved still satisfies every foreign key while no longer
-- describing the recipe it names. That is the same silent shape the merge guard
-- exists for, reachable here from an ordinary PATCH. A variant's three ids are
-- decided when it is created; the label is the only thing about it that is an
-- opinion.
create or replace function public.recipe_variants_before_update()
    returns trigger
    language plpgsql
as $function$
begin
    if new.profile_id is distinct from old.profile_id
        or new.base_recipe_id is distinct from old.base_recipe_id
        or new.recipe_id is distinct from old.recipe_id then
        raise exception using
            errcode = 'restrict_violation',
            message = 'recipe_variants: profile_id, base_recipe_id and recipe_id are immutable',
            hint = 'Only `label` may be updated. To point at a different recipe, delete this row and insert a new one.';
    end if;

    new.updated_at := now();
    return new;
end;
$function$;

drop trigger if exists trg_recipe_variants_before_update on recipe_variants;

create trigger trg_recipe_variants_before_update
    before update
    on recipe_variants
    for each row
execute function public.recipe_variants_before_update();

------------------------------------------------------------------------------
-- 2. recipe_family_defaults: the pin
------------------------------------------------------------------------------

create table if not exists recipe_family_defaults
(
    id             uuid primary key                  default gen_random_uuid(),
    profile_id     uuid                     not null references profiles (id) on delete cascade,
    -- The family, identified by its base recipe. Cascades: if the dish is gone
    -- there is nothing left to have a preference about.
    base_recipe_id uuid                     not null references recipes (id) on delete cascade,
    -- The version to open by default. Either a variant of `base_recipe_id`, or
    -- `base_recipe_id` itself, meaning "the original". Validated by trigger —
    -- the rule needs a subquery, so it cannot be a check constraint.
    recipe_id      uuid                     not null references recipes (id) on delete cascade,
    created_at     timestamp with time zone not null default now(),
    updated_at     timestamp with time zone not null default now(),
    constraint recipe_family_defaults_profile_base_key unique (profile_id, base_recipe_id)
);

create index if not exists idx_recipe_family_defaults_recipe_id
    on recipe_family_defaults using btree (recipe_id);

-- The pin must name something that is actually in the family, and — for a
-- variant — something this user has actually SAVED.
--
-- The saved requirement is not bureaucracy. An unsaved variant recipe row is an
-- orphan by construction: `delete_orphan_generated_recipes` keeps a generated
-- recipe alive precisely because a `recipe_variants` row points at it. Allowing
-- a pin on an unsaved variant would create a preference whose target the sweep
-- is free to delete, which surfaces as a dish that silently loses the version
-- the user chose.
create or replace function public.recipe_family_defaults_validate()
    returns trigger
    language plpgsql
as $function$
begin
    if new.recipe_id = new.base_recipe_id then
        -- Pinning the original. Always legitimate, and the only place in this
        -- schema where recipe_id = base_recipe_id MEANS something — see the
        -- header, and 20260815000001 for the shape it must not be confused with.
        return new;
    end if;

    if not exists (select 1
                   from recipes r
                   where r.id = new.recipe_id
                     and r.base_recipe_id = new.base_recipe_id) then
        raise exception using
            errcode = 'foreign_key_violation',
            message = format('recipe_family_defaults: recipe %s is not a variant of base %s',
                             new.recipe_id, new.base_recipe_id);
    end if;

    if not exists (select 1
                   from recipe_variants v
                   where v.profile_id = new.profile_id
                     and v.recipe_id = new.recipe_id) then
        raise exception using
            errcode = 'foreign_key_violation',
            message = format('recipe_family_defaults: variant %s is not saved by profile %s',
                             new.recipe_id, new.profile_id),
            hint = 'Save the variant (insert into recipe_variants) before pinning it as the default.';
    end if;

    new.updated_at := now();
    return new;
end;
$function$;

drop trigger if exists trg_recipe_family_defaults_validate on recipe_family_defaults;

create trigger trg_recipe_family_defaults_validate
    before insert or update
    on recipe_family_defaults
    for each row
execute function public.recipe_family_defaults_validate();

-- Un-saving a variant retracts any pin that named it. Without this the pin
-- outlives its target's only protection from the orphan sweep, which is the
-- exact state the validate trigger above refuses to let anyone create directly.
create or replace function public.recipe_variants_after_delete()
    returns trigger
    language plpgsql
as $function$
begin
    delete
    from recipe_family_defaults d
    where d.profile_id = old.profile_id
      and d.recipe_id = old.recipe_id;

    return old;
end;
$function$;

drop trigger if exists trg_recipe_variants_after_delete on recipe_variants;

create trigger trg_recipe_variants_after_delete
    after delete
    on recipe_variants
    for each row
execute function public.recipe_variants_after_delete();

alter table recipe_family_defaults enable row level security;

-- Scoped exactly like users_manage_own_recipe_variants: the profile must be the
-- caller's. FOR ALL with no WITH CHECK, so Postgres uses the USING expression
-- for both — a caller cannot insert a row under someone else's profile id.
create policy users_manage_own_recipe_family_defaults on recipe_family_defaults for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));

------------------------------------------------------------------------------
-- 3. The RPCs the client calls
------------------------------------------------------------------------------

-- Rename. Returns the updated row so the caller can write it straight into its
-- cache instead of refetching the list.
--
-- The trim happens HERE rather than in the client: a label is compared by eye in
-- a list, and " Vegetarian" sorting apart from "Vegetarian" is the kind of
-- difference nobody can see and everybody reports as a bug.
create or replace function public.rename_recipe_variant(p_variant_id uuid, p_label text)
    returns recipe_variants
    language plpgsql
as $function$
declare
    v_row recipe_variants;
begin
    if coalesce(btrim(p_label), '') = '' then
        raise exception using
            errcode = 'check_violation',
            message = 'rename_recipe_variant: label must not be empty';
    end if;

    update recipe_variants
    set label = left(btrim(p_label), 80)
    where id = p_variant_id
    returning * into v_row;

    -- Zero rows means the id does not exist OR RLS hid it. Deliberately one
    -- message for both: distinguishing them tells a caller whether a variant id
    -- belonging to someone else is real.
    if v_row.id is null then
        raise exception using
            errcode = 'no_data_found',
            message = format('rename_recipe_variant: no variant %s for this user', p_variant_id);
    end if;

    return v_row;
end;
$function$;

-- Pin. Takes ANY recipe in the family — a variant, or the base — and resolves
-- the family itself, so the client never has to know which of the two it is
-- holding. Idempotent, and an upsert on (profile_id, base_recipe_id), so a
-- family cannot momentarily have two defaults the way a
-- clear-then-insert would allow.
create or replace function public.set_recipe_family_default(p_recipe_id uuid)
    returns recipe_family_defaults
    language plpgsql
as $function$
declare
    v_profile_id uuid := current_profile_id();
    v_base_id    uuid;
    v_row        recipe_family_defaults;
begin
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'set_recipe_family_default: no profile for the current user';
    end if;

    select coalesce(r.base_recipe_id, r.id)
    into v_base_id
    from recipes r
    where r.id = p_recipe_id;

    if v_base_id is null then
        raise exception using
            errcode = 'no_data_found',
            message = format('set_recipe_family_default: no recipe %s', p_recipe_id);
    end if;

    insert into recipe_family_defaults (profile_id, base_recipe_id, recipe_id)
    values (v_profile_id, v_base_id, p_recipe_id)
    on conflict (profile_id, base_recipe_id)
        do update set recipe_id = excluded.recipe_id
    returning * into v_row;

    return v_row;
end;
$function$;

-- Unpin — "go back to no preference", which is NOT the same as pinning the
-- base. A family with no row falls back to whatever the app shows by default,
-- and follows it if that ever changes; a pin on the base is a standing choice
-- that outranks it.
create or replace function public.clear_recipe_family_default(p_recipe_id uuid)
    returns boolean
    language plpgsql
as $function$
declare
    v_profile_id uuid := current_profile_id();
    v_base_id    uuid;
    v_deleted    integer;
begin
    if v_profile_id is null then
        raise exception using
            errcode = 'insufficient_privilege',
            message = 'clear_recipe_family_default: no profile for the current user';
    end if;

    select coalesce(r.base_recipe_id, r.id)
    into v_base_id
    from recipes r
    where r.id = p_recipe_id;

    if v_base_id is null then
        return false;
    end if;

    with removed as (
        delete from recipe_family_defaults d
            where d.profile_id = v_profile_id
                and d.base_recipe_id = v_base_id
            returning d.id)
    select count(*) into v_deleted from removed;

    return v_deleted > 0;
end;
$function$;

-- Read. One round trip for the two facts the version selector opens with: which
-- family this recipe belongs to, and which version of it the user pinned.
--
-- Always returns exactly one row, even for a recipe with no family and no pin —
-- an empty result and "no default set" are different answers, and a client that
-- cannot tell them apart cannot distinguish "show the original" from "the id you
-- gave me does not exist".
create or replace function public.get_recipe_family_default(p_recipe_id uuid)
    returns table
            (
                base_recipe_id    uuid,
                default_recipe_id uuid
            )
    language sql
    stable
as $function$
select coalesce(r.base_recipe_id, r.id)                as base_recipe_id,
       (select d.recipe_id
        from recipe_family_defaults d
        where d.profile_id = current_profile_id()
          and d.base_recipe_id = coalesce(r.base_recipe_id, r.id)) as default_recipe_id
from recipes r
where r.id = p_recipe_id;
$function$;

------------------------------------------------------------------------------
-- 4. merge_recipe learns about the new table
------------------------------------------------------------------------------
--
-- Reproduced from 20260815000001 with one block added. The guard is unchanged
-- and still refuses any `p_from` that `recipe_variants` references in either
-- column, which already covers most of what could be pinned — but a pin can
-- name a BASE that has no saved variants of its own, and that base is mergeable.
--
-- Repointed conflict-safely rather than guarded: unlike a saved variant, a pin
-- holds no content. Losing one costs a preference; the merge is right about the
-- two recipes being the same dish, so following the survivor is the correct
-- answer rather than a lossy fallback.
create or replace function public.merge_recipe(p_from uuid, p_into uuid)
    returns void
    language plpgsql
as $function$
declare
    v_variant_labels text;
begin
    if p_from is null or p_into is null or p_from = p_into then
        return;
    end if;

    -- The guard. Before anything is repointed or deleted.
    select string_agg(distinct quote_literal(label), ', ')
      into v_variant_labels
      from recipe_variants
     where recipe_id = p_from
        or base_recipe_id = p_from;

    if v_variant_labels is not null then
        raise exception using
            errcode = 'restrict_violation',
            message = format(
                'merge_recipe: refusing to merge %s — a user has saved variant(s) of or from it (%s)',
                p_from, v_variant_labels
            ),
            hint = 'A saved variant shares its base dish''s name AND difficulty, so it looks like a duplicate and is not one. '
                   'Decide what happens to the variant first: delete the recipe_variants row to accept losing it, '
                   'or exclude this recipe from the merge to keep it.';
    end if;

    -- collection_recipes: repoint, skipping rows that would collide with an
    -- existing (collection_id, p_into) pair, then drop the leftovers.
    update collection_recipes cr
       set recipe_id = p_into
     where cr.recipe_id = p_from
       and not exists (
           select 1 from collection_recipes cr2
            where cr2.collection_id = cr.collection_id
              and cr2.recipe_id = p_into
       );
    delete from collection_recipes where recipe_id = p_from;

    -- profile_recipe_interactions: same conflict-safe repoint on
    -- (profile_id, recipe_id, interaction_type).
    update profile_recipe_interactions pri
       set recipe_id = p_into
     where pri.recipe_id = p_from
       and not exists (
           select 1 from profile_recipe_interactions pri2
            where pri2.profile_id = pri.profile_id
              and pri2.recipe_id = p_into
              and pri2.interaction_type = pri.interaction_type
       );
    delete from profile_recipe_interactions where recipe_id = p_from;

    -- shopping_lists: no uniqueness on recipe_id — repoint all.
    update shopping_lists set recipe_id = p_into where recipe_id = p_from;

    -- recipe_family_defaults: the pinned VERSION, then the FAMILY. Both are
    -- conflict-safe on (profile_id, base_recipe_id), and the leftovers are
    -- dropped: a user who had pinned versions of both dishes keeps the one on
    -- the surviving family rather than getting an arbitrary winner.
    --
    -- The version repoint runs first and is not conflict-checked, because the
    -- unique key is on the FAMILY: two rows for one profile can name the same
    -- recipe_id only if they sit in different families, which the block below
    -- then resolves.
    update recipe_family_defaults set recipe_id = p_into where recipe_id = p_from;

    update recipe_family_defaults d
       set base_recipe_id = p_into
     where d.base_recipe_id = p_from
       and not exists (
           select 1 from recipe_family_defaults d2
            where d2.profile_id = d.profile_id
              and d2.base_recipe_id = p_into
       );
    delete from recipe_family_defaults where base_recipe_id = p_from;

    -- recipe_variants.recipe_id / base_recipe_id: unreachable now that the guard
    -- above rejects any p_from this table references. Kept so the function stays
    -- correct on its own terms rather than depending on the guard staying put.
    update recipe_variants rv
       set recipe_id = p_into
     where rv.recipe_id = p_from
       and not exists (
           select 1 from recipe_variants rv2
            where rv2.profile_id = rv.profile_id
              and rv2.recipe_id = p_into
       );
    delete from recipe_variants where recipe_id = p_from;

    update recipe_variants set base_recipe_id = p_into where base_recipe_id = p_from;
    update recipes set base_recipe_id = p_into where base_recipe_id = p_from;

    -- Remove the merged-away recipe (cascades its ingredients/instructions/tags).
    delete from recipes where id = p_from;
end;
$function$;

------------------------------------------------------------------------------
-- 5. The orphan sweep keeps a pinned recipe
------------------------------------------------------------------------------
--
-- Still defined and still not scheduled (see 20260801000015). Belt and braces:
-- the validate trigger already refuses a pin on a variant with no
-- `recipe_variants` row, which is what the first NOT EXISTS below protects, so
-- this closes only the base-with-a-pin-and-no-saved-variants case. Cheap, and
-- the alternative is a sweep that can delete the version a user chose.
create or replace function public.delete_orphan_generated_recipes()
    returns integer
    language plpgsql
as $function$
declare
    v_deleted INTEGER;
begin
    WITH removed AS (
        DELETE FROM recipes r
        WHERE r.is_generated = true
          AND r.created_at < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (SELECT 1 FROM recipe_variants v WHERE v.recipe_id = r.id OR v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipe_family_defaults d WHERE d.recipe_id = r.id OR d.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM recipes v WHERE v.base_recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM collection_recipes cr WHERE cr.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM shopping_lists sl WHERE sl.recipe_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM profile_recipe_interactions pri WHERE pri.recipe_id = r.id)
        RETURNING r.id
    )
    SELECT count(*) INTO v_deleted FROM removed;

    RETURN v_deleted;
end;
$function$;

notify pgrst, 'reload schema';
