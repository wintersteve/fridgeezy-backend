-- Accent-folded search columns, so "bechamel" finds "Béchamel Sauce".
--
-- Every catalogue text search in the CLIENT is a PostgREST `ilike` straight at
-- these tables — `searchRecipeCatalogue`, `searchSuggestionCatalogue` and the
-- two entity-strip hooks. `ilike` compares code points, so an unaccented query
-- misses every accented row and the browse screen reports it as "Nothing here
-- goes by that name": Béchamel Sauce, Soufflé, Salade Niçoise, Pâté en Croûte,
-- Moules Marinières, Tagliatelle al Ragù and Supplì were all unreachable
-- unless the reader typed the diacritic on a phone keyboard.
--
-- PostgREST cannot call a function on the column side of a filter, so the fold
-- has to be MATERIALISED. Hence a stored generated column per searchable text
-- column rather than an expression index: an index would speed up a predicate
-- the client has no way to write.
--
-- ## Why NFD-strip and not `unaccent`
--
-- The query is folded on the CLIENT (`foldAccents`, `utils/text-search`) and
-- the row is folded here. Those two must agree exactly or the search misses
-- SILENTLY — no error, just a dish that is not there. `normalize(NFD)` plus a
-- strip of the combining marks is the one fold both platforms implement
-- natively and identically: it is exactly what
-- `String.prototype.normalize("NFD").replace(/[\u0300-\u036f]/g, "")` does, and
-- the client already leans on that same pair agreeing with the backend's
-- `normalizeFileName` for recipe image paths.
--
-- `unaccent` folds MORE (ø->o, æ->ae, ß->ss) and would therefore DISAGREE with
-- the client on exactly those characters. What that costs: a Danish or German
-- dish stays findable only by typing its own letters — which is no worse than
-- today. Coverage is worth less than symmetry here, because asymmetry fails
-- without a symptom. Widen BOTH sides in one change or neither.

create or replace function public.fold_accents(p_text text)
    returns text
    language sql
    immutable
    strict
    parallel safe
as $function$
    -- Decompose, then drop the combining diacritical marks (U+0300–U+036F).
    -- Precomposed input keeps its LENGTH through this, which is what lets the
    -- client highlight a match by slicing the original string at indices found
    -- in the folded one.
    select regexp_replace(normalize(p_text, nfd), '[\u0300-\u036f]', '', 'g')
$function$;

comment on function public.fold_accents(text) is
    'NFD-strip of the combining marks. Must stay identical to foldAccents() in the client''s utils/text-search — see this migration''s header.';

alter table recipes
    add column if not exists name_ascii text
        generated always as (public.fold_accents(name)) stored,
    add column if not exists name_en_ascii text
        generated always as (public.fold_accents(name_en)) stored,
    add column if not exists short_description_ascii text
        generated always as (public.fold_accents(short_description)) stored,
    add column if not exists description_ascii text
        generated always as (public.fold_accents(description)) stored;

alter table recipe_suggestions
    add column if not exists name_ascii text
        generated always as (public.fold_accents(name)) stored,
    add column if not exists name_en_ascii text
        generated always as (public.fold_accents(name_en)) stored,
    add column if not exists description_ascii text
        generated always as (public.fold_accents(description)) stored;

-- Read by the ingredient entity strip and by the `!inner` join filter both
-- catalogue searches resolve their related ids through.
alter table ingredients
    add column if not exists name_ascii text
        generated always as (public.fold_accents(name)) stored;

-- Same, plus the widened entity strip, which now searches every tag type
-- rather than cuisines alone.
alter table tags
    add column if not exists name_ascii text
        generated always as (public.fold_accents(name)) stored;
