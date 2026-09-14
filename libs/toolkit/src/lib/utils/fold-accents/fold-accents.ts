/**
 * Strip diacritics: "Béchamel" -> "Bechamel", "Jalapeño" -> "Jalapeno".
 *
 * Byte-identical to `public.fold_accents(text)` in SQL:
 *
 * ```sql
 * select regexp_replace(normalize(p_text, nfd), '[̀-ͯ]', '', 'g')
 * ```
 *
 * ## Why this rule and not `unaccent`
 *
 * NFD-decompose then drop the combining marks (U+0300–U+036F) is the one fold
 * Postgres and JavaScript both implement natively and IDENTICALLY. `unaccent`
 * folds further (ø→o, æ→ae, ß→ss) and JavaScript would not follow it, so the two
 * sides would disagree on exactly those characters — and a divergence here is
 * silent, which is the whole reason the rule is pinned rather than chosen per
 * call site. The same argument already governs the accent-folded search columns;
 * this is the same fold, applied to identity instead of to search.
 *
 * It is **length-preserving** for precomposed input, and it does **not**
 * lowercase — both inherited from the SQL side, and both relied on elsewhere.
 *
 * ## What it is for here
 *
 * Every canonical-id rule folds through this before collapsing to underscores.
 * Without it `[^a-z0-9]+ -> _` turns an accented letter into a SEPARATOR, so
 * "Béchamel" became `b_chamel` while "Bechamel" became `bechamel` — two
 * identities for one dish, and nothing in the write path could tell them apart.
 * Measured on the dev catalogue 2026-09-13, that had already split four pairs of
 * live rows: Ragu/Ragù, Crème Fraîche/Creme Fraiche, Jalapeño/Jalapeno, and the
 * tag aliases provencal/provençal. It also decided, at random, whether a chat
 * turn asking for "Béchamel" found the stored suggestion or generated a new one.
 */
export function foldAccents(value: string): string {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
