// buildSuggestionSignature lives in @fridgeezy/toolkit so the app (store + query
// side) and the re-signature backfill build it identically. Re-exported here so
// the suggestion services import it alongside describeSuggestion from one place.
export { buildSuggestionSignature } from "@fridgeezy/toolkit";

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
