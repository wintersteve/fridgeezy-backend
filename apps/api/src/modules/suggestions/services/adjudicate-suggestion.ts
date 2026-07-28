import { openai } from "@fridgeezy/openai";

const SYSTEM_PROMPT = `You decide whether two dish descriptions refer to the SAME dish for a recipe database.

- "same": they are the same dish — the same recipe under a different name, a translation/transliteration, or a trivial spelling variant (e.g. "Som Tam" and "Green Papaya Salad"; "Murgh Makhani" and "Butter Chicken").
- NOT the same: genuinely distinct dishes, including authentic regional or preparation VARIATIONS that differ in defining ingredients or technique (e.g. Thai vs Lao green papaya salad; a roux vs a béchamel).

Weigh the defining ingredients and cuisine, not just the name. Respond with a single JSON object and nothing else: {"same": true|false}.`;

/**
 * LLM adjudication for the dedup gray zone: are dish A and dish B the same dish?
 * Each argument is a short descriptor (English name, cuisine/tags, ingredients).
 * Fails CLOSED (false) on any error so an LLM hiccup never merges distinct dishes.
 */
export async function adjudicateSameDish(
    dishA: string,
    dishB: string
): Promise<boolean> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `DISH A:\n${dishA}\n\nDISH B:\n${dishB}` },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 10,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return false;
        return (JSON.parse(content) as { same?: boolean }).same === true;
    } catch (error) {
        console.error("[Suggestions] Dish adjudication failed:", error);
        return false;
    }
}
