// buildSuggestionSignature lives in @fridgeezy/toolkit so the app (store + query
// side) and the re-signature backfill build it identically. Re-exported here so
// the suggestion services import it alongside describeSuggestion from one place.
export { buildSuggestionSignature } from "@fridgeezy/toolkit";

// Thresholds calibrated from real signature-similarity distributions (see
// evals/calibrate-thresholds): same-dish pairs range ~0.74–1.00, different-dish
// pairs top out ~0.80 (they overlap — a low-signal same-dish pair like
// "Gyoza"/"Japanese Dumplings" scores ~0.74, below a near-miss distinct pair like
// Thai/Lao papaya salad ~0.80). So auto-merge only well above the distinct max,
// and send everything down to ~0.72 to the LLM rather than a hard cutoff.
// Shared by suggestion↔suggestion and suggestion↔recipe dedup so both sides of
// the catalog judge "same dish" by the same rule.
/** Signature cosine similarity at/above which two dishes auto-merge (no LLM). */
export const SIGNATURE_HIGH_THRESHOLD = 0.92;
/** Below this, candidates are treated as distinct dishes (no adjudication). */
export const SIGNATURE_LOW_THRESHOLD = 0.72;

/**
 * Human-readable dish descriptor for the LLM same-dish adjudicator (labelled, so
 * the model weighs name/cuisine/ingredients explicitly). App-only — the backfill
 * doesn't adjudicate.
 */
export function describeSuggestion(
    name: string,
    nameEn: string | null | undefined,
    tags: string[],
    ingredients: string[]
): string {
    return [
        `name: ${nameEn?.trim() || name}`,
        `tags: ${tags.join(", ") || "(none)"}`,
        `ingredients: ${ingredients.join(", ") || "(none)"}`,
    ].join("\n");
}
