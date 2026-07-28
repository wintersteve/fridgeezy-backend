import { openai } from "@fridgeezy/openai";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";

import { describeSuggestion } from "./suggestion-signature";

/** Minimum confidence for an attested verdict to be trusted. */
const CONFIDENCE_FLOOR = 0.6;

const SYSTEM_PROMPT = `You verify that a proposed recipe is a REAL, attested dish before it enters a discovery catalog.

Classify the dish into one status:
- "canonical": a well-documented traditional dish (e.g. Murgh Makhani, Spaghetti alla Carbonara).
- "regional_variant": an attested regional or traditional variation of a real dish (e.g. Lao-style green papaya salad).
- "modern_fusion": a plausible modern or fusion creation, but not a traditional/attested dish.
- "invention": an arbitrary combination unlikely to be an established dish (e.g. "Carbonara with Asparagus"), or a hallucinated / non-existent dish.
- "unknown": you cannot tell.

Only "canonical" and "regional_variant" belong in a discovery catalog. Weigh the ingredients and cuisine, not just the name.

Respond with a single JSON object and nothing else:
{"status":"canonical"|"regional_variant"|"modern_fusion"|"invention"|"unknown","confidence":0.0-1.0}.`;

/**
 * Authenticity gate: is this an attested dish that belongs in discovery? A second
 * pass over the generator's own "AUTHENTICITY IS PARAMOUNT" prompt — catches
 * inventions/hallucinations the generator lets through. Only runs for genuinely
 * new dishes (dedup handles the already-vetted existing ones). Fails OPEN
 * (authentic) on any error so an LLM hiccup never drops valid dishes.
 */
export async function verifySuggestionAuthenticity(
    suggestion: GenerateSuggestionResponseDto
): Promise<boolean> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: describeSuggestion(
                        suggestion.name,
                        suggestion.name_en,
                        suggestion.tags,
                        suggestion.ingredients
                    ),
                },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 20,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return true;

        const parsed = JSON.parse(content) as {
            status?: string;
            confidence?: number;
        };
        const attested =
            parsed.status === "canonical" ||
            parsed.status === "regional_variant";
        const confident = (parsed.confidence ?? 0) >= CONFIDENCE_FLOOR;
        return attested && confident;
    } catch (error) {
        console.error(
            `[Suggestions] Authenticity check failed for "${suggestion.name}" — allowing:`,
            error
        );
        return true;
    }
}
