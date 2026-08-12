/**
 * Name identity for comparing two JS-normalized names TO EACH OTHER: lowercase,
 * every run of non-alphanumerics collapsed to one underscore, and leading or
 * trailing underscores stripped. So "Apfelstrudel", "apfelstrudel" and
 * " Apfelstrudel! " are one dish.
 *
 * ⚠️ **This does NOT mirror any `canonical_id` in the database**, despite what
 * this comment used to claim. The edge-underscore strip on the last line is the
 * difference, and " Apfelstrudel! " — the example above — is exactly a case
 * where the three rules disagree:
 *
 * | | " Apfelstrudel! " |
 * | --- | --- |
 * | this | `apfelstrudel` |
 * | `suggestionCanonicalId` (the triggers) | `apfelstrudel_` |
 * | `sqlCanonicalId` (`normalize_to_canonical_id`) | `_apfelstrudel_` |
 *
 * Use this ONLY when both sides are normalized here — an exclusion list against
 * generated names, tag identity, dedup keys within one response. The moment one
 * side is a stored column, reach for the rule that produced it:
 * `suggestionCanonicalId` from this package for anything trigger-stamped
 * (`recipe_suggestions`, `ingredients`, `categories`, `tag_aliases`), or
 * `sqlCanonicalId` in `recipes.repository.ts` for the generated
 * `recipes.canonical_id`.
 *
 * Returns null for a name that normalizes to nothing, so an empty or
 * punctuation-only value can never match another.
 */
export function canonicalizeName(value: string | null | undefined): string | null {
    const normalized = (value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return normalized || null;
}
