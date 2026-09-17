-- # The version chain
--
-- A version of a dish is the dish plus an ordered list of asks — "no dairy",
-- then "spicier" — and until now only the last ask was recorded. Two columns
-- fix that, and they answer two different questions.
--
-- ## `recipe_variants.source_recipe_id` — which copy this was written from
--
-- `modify-recipe.ts` already reads the recipe the reader was ON, so the CONTENT
-- compounds correctly: asking for "spicier" from a dairy-free copy really does
-- produce one that is both. What was lost is the RECORD of it. `resolveVariantBase`
-- keeps `recipes.base_recipe_id` flat on purpose — the partial unique index
-- `recipes_canonical_id_difficulty_unique` and every family read depend on one
-- level — so the second version filed as a SIBLING of the first, named after one
-- of the two things that happened to it.
--
-- So the lineage of INTENT lives here instead, in the per-profile table, which is
-- free to be a chain. `recipes` stays flat.
--
-- **Nullable, and deliberately not backfilled.** Null means "written from the
-- base", which is what every existing row is as far as anything can know — and
-- it is also the honest answer for a row written before this column existed.
-- Every reader treats `source_recipe_id ?? base_recipe_id` as the parent, so
-- existing data keeps exactly the shape it has today.
--
-- `on delete set null` rather than cascade: losing the copy a version was written
-- from must not delete the version. The chain degrades to "written from the base",
-- which is the same fallback the null case already takes.
--
-- ## `recipes.is_personal` — the firewall
--
-- `useRecipeDifficulties` and `useRecipeByNameAndDifficulty` find a dish's
-- difficulty rungs by NAME, and deliberately do not filter variants out: an
-- escalated rung IS a variant row (`escalate-difficulty.ts` parents it to the
-- family base). That is correct while the only rows at a new level are rungs
-- somebody generated for the dish.
--
-- It stops being correct the moment a reader can write a version at a level the
-- dish has no base row for — which is exactly what the difficulty ladder inside a
-- version now does. Without this column, one reader's dairy-free ragù becomes
-- what a stranger gets when they tap Hard. Today that is safe only by accident:
-- versions always carried the base's level, and the base wins the tie.
--
-- **Maintained by a trigger, not by the writers.** A personal copy is exactly a
-- recipe some profile has a `recipe_variants` row for, so the fact is already in
-- the database and deriving it in a trigger means no writer can forget. It also
-- avoids changing `persist_recipe`'s signature, which creates a SECOND function
-- rather than replacing the first and leaves PostgREST disambiguating on argument
-- names (see 20260815000002).
--
-- The client cannot derive this for itself: `recipe_variants` is per-profile under
-- RLS, so a reader cannot see anyone else's rows and cannot tell a shared rung
-- from somebody's copy. The column says so without saying whose.
--
-- It is never set back to false. Un-saving a version deletes the join row but
-- leaves the recipe behind for the orphan sweep (see `useDeleteRecipeVariant`),
-- and a row that was once somebody's personal copy must not quietly re-enter the
-- catalogue's rung map on its way to being deleted.

alter table recipe_variants
    add column if not exists source_recipe_id uuid references recipes (id) on delete set null;

comment on column recipe_variants.source_recipe_id is
    'The copy this version was written from; null means the family base. Parent is always coalesce(source_recipe_id, base_recipe_id).';

-- The read this supports is "what continues from the copy I am reading", scoped
-- to one profile — the branch lookup behind both the dedup and the leaf rule.
create index if not exists idx_recipe_variants_profile_source
    on recipe_variants using btree (profile_id, source_recipe_id);

alter table recipes
    add column if not exists is_personal boolean not null default false;

comment on column recipes.is_personal is
    'True once any profile has saved this recipe as one of their versions. Excluded from the dish-wide difficulty rung map so one reader''s copy is never served as the catalogue''s rung.';

create or replace function mark_recipe_personal() returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    update recipes
    set is_personal = true
    where id = new.recipe_id
      and is_personal = false;

    return new;
end;
$$;

comment on function mark_recipe_personal() is
    'Keeps recipes.is_personal in step with recipe_variants. security definer because the inserting profile owns the variant row but not the recipe row.';

drop trigger if exists trg_recipe_variants_mark_personal on recipe_variants;

create trigger trg_recipe_variants_mark_personal
    after insert
    on recipe_variants
    for each row
execute function mark_recipe_personal();

-- Backfill. Every recipe anybody has already saved as a version is personal by
-- the same definition, and leaving them out would mean the firewall only applied
-- to versions written from today onward.
update recipes
set is_personal = true
where is_personal = false
  and id in (select recipe_id from recipe_variants);

create index if not exists idx_recipes_name_shared
    on recipes using btree (name)
    where is_personal = false;
