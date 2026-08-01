// buildSuggestionSignature lives in @fridgeezy/toolkit so the app (store + query
// side) and the re-signature backfill build it identically. Re-exported here so
// the suggestion services import it alongside describeSuggestion from one place.
export { buildSuggestionSignature } from "@fridgeezy/toolkit";

// Thresholds calibrated from real signature-similarity distributions (see
// evals/calibrate-thresholds). Recalibrated 2026-07-31, after the signature moved
// from `name_en` to the canonical `name`: CROSS-NAME same-dish
// pairs now score 0.77–0.84 and different-dish pairs top out at 0.80, so the two
// distributions still overlap and the LLM still has to resolve the middle.
//
// The old note said same-dish reached 1.00; that was pairs sharing an identical
// `name_en`. Those score ~1.00 for a different reason now — two suggestions for
// one dish are SUPPOSED to land on the same canonical name, which is exactly the
// case HIGH is for. HIGH therefore stays at 0.92: it auto-merges the same-name
// case and sends every cross-name case (max 0.84) to the adjudicator, which is
// the intended split.
//
// LOW moved 0.72 -> 0.75. It has to sit under the same-dish minimum (0.77) so
// real matches still reach the gray band, and 0.72 additionally dragged in
// distinct pairs scoring 0.749/0.750 (Carbonara/Cacio e Pepe, Pad Thai/Pad See
// Ew) — LLM calls that could only ever answer "no".
//
// Shared by suggestion↔suggestion and suggestion↔recipe dedup so both sides of
// the catalog judge "same dish" by the same rule.
/** Signature cosine similarity at/above which two dishes auto-merge (no LLM). */
export const SIGNATURE_HIGH_THRESHOLD = 0.92;
/** Below this, candidates are treated as distinct dishes (no adjudication). */
export const SIGNATURE_LOW_THRESHOLD = 0.75;

/**
 * Human-readable dish descriptor for the LLM same-dish adjudicator (labelled, so
 * the model weighs name/cuisine/ingredients explicitly). App-only — the backfill
 * doesn't adjudicate.
 *
 * Leads with the canonical `name` and offers the alternate spelling as a second
 * line when there is one. Unlike the signature — which has to embed ONE stable
 * string — the adjudicator is just reading, so the alias is free extra signal
 * for exactly the case it exists to settle (Som Tam ≡ Green Papaya Salad).
 */
export function describeSuggestion(
    name: string,
    nameAlt: string | null | undefined,
    tags: string[],
    ingredients: string[]
): string {
    const alt = nameAlt?.trim();

    return [
        `name: ${name}`,
        ...(alt && alt !== name ? [`also known as: ${alt}`] : []),
        `tags: ${tags.join(", ") || "(none)"}`,
        `ingredients: ${ingredients.join(", ") || "(none)"}`,
    ].join("\n");
}
