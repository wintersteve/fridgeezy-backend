-- A saved version says which copy of a dish it is. It has never said what it is
-- FOR, or who asked for it.
--
-- `recipe_variants.label` is the only description a version carries, and it is
-- derived by regex from the instruction (`deriveVariantLabel`: "make it vegan"
-- -> "Vegan"). Three different things write rows here and the table cannot tell
-- them apart:
--
--   asked     the reader typed an instruction in the recipe chat
--   tuned     the reader pressed personalise; the server read their preferences
--   adjusted  nobody asked — a promotion hit the caller's blacklist, the server
--             wrote an adapted copy, and the client linked it silently
--
-- The third is the one that needs this most. It is written with no toast by
-- design, it is eligible to be pinned as the family default, and the reader
-- meets it days later as a word they have no memory of choosing.
--
-- ## Nullable, and NOT backfilled
--
-- Every existing row could be stamped `asked` on the grounds that most of them
-- are. Most is not all, and the wrong arm here says "you asked for this" about a
-- version the reader never asked for — which is the exact failure these columns
-- exist to fix, applied backwards. NULL means "not recorded", never a claim, and
-- the client draws what it drew before for one.
--
-- ## Mutable, unlike the three ids
--
-- `recipe_variants_before_update` freezes profile_id/base_recipe_id/recipe_id
-- because a row whose recipe moved still satisfies every foreign key while no
-- longer describing the recipe it names. These two are not that: the write path
-- is an upsert on (profile_id, recipe_id), so a re-run has to be able to write
-- them again. Only the hint changes below, to stop claiming `label` is the one
-- updatable column.

alter table recipe_variants
    add column if not exists origin text;

alter table recipe_variants
    drop constraint if exists recipe_variants_origin_check;

alter table recipe_variants
    add constraint recipe_variants_origin_check
        check (origin is null or origin in ('asked', 'tuned', 'adjusted'));

comment on column recipe_variants.origin is
    'How this version came to exist: asked (reader''s instruction), tuned (their standing preferences), adjusted (written for them unprompted). NULL means not recorded — never a claim.';

-- The reader's own words, kept verbatim.
--
-- `label` is the compressed form and is what the eyebrow prints; this is the
-- sentence it was compressed from, and it is the version's intent stated by the
-- only party qualified to state it. Capped rather than unbounded because it is
-- rendered in one line under a title, and empty-string is rejected so "no
-- instruction" has exactly one representation.
alter table recipe_variants
    add column if not exists instruction text;

alter table recipe_variants
    drop constraint if exists recipe_variants_instruction_check;

alter table recipe_variants
    add constraint recipe_variants_instruction_check
        check (instruction is null or char_length(btrim(instruction)) between 1 and 500);

comment on column recipe_variants.instruction is
    'The instruction the reader typed, verbatim. NULL for tuned and adjusted versions, which nobody phrased.';

-- Unchanged but for the hint, which named `label` as the only updatable column
-- and would now send a reader after the wrong thing.
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
            hint = 'Only `label`, `origin` and `instruction` may be updated. To point at a different recipe, delete this row and insert a new one.';
    end if;

    new.updated_at := now();
    return new;
end;
$function$;

notify pgrst, 'reload schema';
