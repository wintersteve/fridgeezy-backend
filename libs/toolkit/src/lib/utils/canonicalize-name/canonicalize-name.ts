/**
 * The schema's identity rule for a name, in JS: lowercase, with every run of
 * non-alphanumerics collapsed to a single underscore. Mirrors the
 * `normalize_to_canonical_id` SQL function and the `canonical_id` triggers, so
 * "Apfelstrudel" / "apfelstrudel" / " Apfelstrudel! " are one dish.
 *
 * Shared because `recipes` — unlike `ingredients` and `recipe_suggestions` — has
 * no canonical_id column to compare against, so anything matching recipes by
 * name has to apply the same rule itself or two tables will disagree about what
 * counts as the same dish.
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
