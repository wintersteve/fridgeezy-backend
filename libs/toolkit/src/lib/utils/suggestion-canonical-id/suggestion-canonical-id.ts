/**
 * Dish identity as the DATABASE computes it for `recipe_suggestions` — trim,
 * lowercase, then collapse every run of non-alphanumerics to one underscore.
 *
 * Byte-identical to the `set_recipe_suggestion_canonical_id` trigger:
 *
 * ```sql
 * new.canonical_id := regexp_replace(lower(trim(new.name)), '[^a-z0-9]+', '_', 'g');
 * ```
 *
 * ## Why this is not {@link canonicalizeName}
 *
 * They agree on every ordinary dish name and differ on names that begin or end
 * with punctuation, because `canonicalizeName` strips leading/trailing
 * underscores and the trigger does not — `trim()` removes whitespace, not
 * punctuation, so the run at the edge still becomes an underscore in SQL:
 *
 * | input | this / the DB | `canonicalizeName` |
 * | --- | --- | --- |
 * | `"Tarte Tatin"` | `tarte_tatin` | `tarte_tatin` |
 * | `"Sunomono!"` | `sunomono_` | `sunomono` |
 * | `" Apfelstrudel! "` | `apfelstrudel_` | `apfelstrudel` |
 *
 * That divergence was latent rather than firing: both sides of every comparison
 * used the same rule, so nothing disagreed. It stops being latent as soon as one
 * side is the stored column and the other is computed in JS — the batch dedup
 * coordinator keys dishes in memory that the database keys with the trigger, and
 * those two must not be able to disagree about what one dish is.
 *
 * Three rules now exist and none is interchangeable with another:
 *
 * - **this** — mirrors the `canonical_id` TRIGGERS (`recipe_suggestions`,
 *   `ingredients`, `categories`, `tag_aliases`). Trims, keeps edge underscores.
 * - **`sqlCanonicalId`** (in `recipes.repository.ts`) — mirrors the
 *   `normalize_to_canonical_id` SQL FUNCTION behind the generated
 *   `recipes.canonical_id` column. Does NOT trim, keeps edge underscores.
 * - **{@link canonicalizeName}** — for comparing two JS-normalized names to each
 *   other, where nothing is being matched against a stored column.
 *
 * Returns null only for empty or whitespace-only input, so a missing name can
 * never match another missing name. A punctuation-only name returns the
 * underscore the database would actually store.
 */
export function suggestionCanonicalId(
    value: string | null | undefined
): string | null {
    const trimmed = (value ?? "").trim();

    if (!trimmed) return null;

    return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
