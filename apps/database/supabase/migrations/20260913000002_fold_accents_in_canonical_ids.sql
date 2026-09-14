-- Canonical ids fold accents, so "Béchamel" and "Bechamel" are one identity.
--
-- WHAT WAS WRONG
-- Every canonical-id rule in this schema collapses `[^a-z0-9]+` to an
-- underscore. An accented letter is not in `a-z`, so it was read as a
-- SEPARATOR rather than as a letter:
--
--   normalize_to_canonical_id('Béchamel') -> 'b_chamel'
--   normalize_to_canonical_id('Bechamel') -> 'bechamel'
--
-- Two identities for one dish, and nothing in any write path could tell them
-- apart — the same class of split `20260824…`'s `brussel_sprout` note
-- describes, and just as invisible: a miss looks exactly like "not seen
-- before", so the second row is CREATED rather than reported.
--
-- It was not theoretical. Measured on the dev catalogue 2026-09-13, four pairs
-- of live rows were already split by nothing but a diacritic:
--
--   ingredients   Ragu / Ragù              -> both are 'ragu'
--   ingredients   Crème Fraîche / Creme Fraiche -> both are 'creme_fraiche'
--   ingredients   Jalapeño / Jalapeno      -> both are 'jalapeno'
--   tag_aliases   provencal / provençal    -> both are 'provencal'
--
-- and `recipe_suggestions` held one row under 'b_chamel', which is what decided
-- — by whether the router happened to type the accent — whether a chat turn
-- asking for a béchamel found the stored dish or generated a new one.
--
-- The single ingredient alias in the whole database was `béchamel sauce` ->
-- `Bechamel Sauce`: a row whose only job was to bridge this split by hand.
--
-- WHY `fold_accents` AND NOT `unaccent`
-- `fold_accents` already exists (`20260825000001`) for the accent-folded search
-- columns, and it is NFD-decompose-then-drop-combining-marks precisely because
-- that is the one fold Postgres and JavaScript implement identically. The
-- canonical ids are computed on BOTH sides — `@fridgeezy/toolkit` mirrors every
-- rule here — so they need a fold JavaScript can reproduce exactly. `unaccent`
-- folds further (ø→o, æ→ae, ß→ss) and would silently disagree on those.
--
-- The JS half moved in the same change: `foldAccents` in `@fridgeezy/toolkit`,
-- applied in `canonicalizeName`, `suggestionCanonicalId`, `ingredientCanonicalId`
-- and `sqlCanonicalId`. **Widen both sides together or neither**, the same rule
-- the search-column fold already carries.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- It does not touch a single existing row. Redefining these functions changes
-- what FUTURE writes compute; stored ids keep their old values, and the four
-- pairs above stay split until they are merged — which cannot be a blind UPDATE
-- because each pair would then collide on its own unique index.
--
-- The repair is `nx run @fridgeezy/database:fold-accent-ids`, which dry-runs by
-- default, merges ingredient pairs through `merge_ingredient` (keeping the
-- losing spelling as an alias, so it cannot come back), and recomputes the rest.
-- **Run it directly after this migration.** In the window between the two, a
-- newly written "Bechamel" lands on 'bechamel' while the stored row is still
-- 'b_chamel', so both exist — which is the state this already leaves behind
-- anyway, just no longer growing.

-- The chokepoint. `ingredient_canonical_id` calls this, so folding here covers
-- ingredients too.
create or replace function public.normalize_to_canonical_id(input_text text)
returns text
language plpgsql
immutable
as $$
begin
    return lower(
        regexp_replace(
            regexp_replace(
                public.fold_accents(input_text), '[^a-zA-Z0-9]+', '_', 'g'
            ),
            '_+', '_', 'g'
        )
    );
end;
$$;

-- The four triggers that inline the same regex rather than calling the function
-- above. They are left inline (rather than rewritten to call it) because each
-- differs in its trimming, and those differences are load-bearing — see
-- `suggestionCanonicalId`'s note on the three distinct rules.

create or replace function public.set_recipe_suggestion_canonical_id()
returns trigger
language plpgsql
as $$
begin
    new.canonical_id := regexp_replace(
        lower(trim(public.fold_accents(new.name))), '[^a-z0-9]+', '_', 'g'
    );
    return new;
end;
$$;

create or replace function public.set_category_canonical_id()
returns trigger
language plpgsql
as $$
begin
    new.canonical_id := regexp_replace(
        lower(trim(public.fold_accents(new.name))), '[^a-z0-9]+', '_', 'g'
    );
    return new;
end;
$$;

create or replace function public.set_tag_alias_canonical_id()
returns trigger
language plpgsql
as $$
begin
    new.canonical_id := regexp_replace(
        lower(trim(public.fold_accents(new.alias))), '[^a-z0-9]+', '_', 'g'
    );
    return new;
end;
$$;

create or replace function public.set_unit_canonical_id()
returns trigger
language plpgsql
as $$
begin
    new.canonical_id := regexp_replace(
        regexp_replace(
            lower(trim(public.fold_accents(new.name))), '[^a-z0-9]+', '_', 'g'
        ),
        '^_|_$', '', 'g'
    );
    return new;
end;
$$;

comment on function public.normalize_to_canonical_id(text) is
    'Canonical identity for a name: accents folded to their base letter, then every run of non-alphanumerics collapsed to one underscore, lowercased. Does NOT trim. Mirrored in JS by sqlCanonicalId; the fold is public.fold_accents, which JavaScript reproduces exactly — do not switch it to unaccent.';
