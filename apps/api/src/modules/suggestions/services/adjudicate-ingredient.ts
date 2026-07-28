import { openai } from "@fridgeezy/openai";

export type IngredientDecision = "same" | "new" | "invalid";

const SYSTEM_PROMPT = `You validate ingredient names for a cooking database.

Given an ingredient NAME and optionally a CANDIDATE existing ingredient, respond with exactly one decision:
- "same": NAME refers to the same ingredient as CANDIDATE — a synonym, regional name, or spelling variant (e.g. "spring onion" vs "scallion"). Only valid when a CANDIDATE is provided.
- "invalid": NAME is not a usable culinary ingredient — gibberish, a dish or recipe name, a hallucination, or an unusable fragment.
- "new": NAME is a real, distinct culinary ingredient (different from CANDIDATE, or there is no candidate).

Respond with a single JSON object and nothing else: {"decision":"same"|"new"|"invalid"}.`;

/**
 * Ingredient creation gate: decide whether an unmatched ingredient name is the
 * same as a near-miss candidate, a genuinely new ingredient, or not a real
 * ingredient at all. Fails open to "new" on any error so an LLM hiccup never
 * silently drops a valid ingredient.
 */
export async function adjudicateIngredient(
    name: string,
    candidateName?: string
): Promise<IngredientDecision> {
    const userPrompt = candidateName
        ? `NAME: ${name}\nCANDIDATE: ${candidateName}`
        : `NAME: ${name}\nCANDIDATE: (none)`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 20,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return "new";

        const parsed = JSON.parse(content) as { decision?: string };

        // "same" is only meaningful against an actual candidate.
        if (parsed.decision === "same" && candidateName) return "same";
        if (parsed.decision === "invalid") return "invalid";
        return "new";
    } catch (error) {
        console.error(
            `[Ingredients] Adjudication failed for "${name}" — defaulting to create:`,
            error
        );
        return "new";
    }
}
