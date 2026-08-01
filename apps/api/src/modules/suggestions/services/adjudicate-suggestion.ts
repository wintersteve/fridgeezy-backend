import { generateCompletion } from "@fridgeezy/llm";

const SYSTEM_PROMPT = `You decide whether two dish descriptions refer to the SAME dish for a recipe database.

- "same": they are the same dish — the same recipe under a different name, a translation or transliteration of the native name, or a trivial spelling variant (e.g. "Som Tam" and "Green Papaya Salad"; "Murgh Makhani" and "Butter Chicken"). A native-language name and its English translation of the SAME dish are ALWAYS "same", even if the two ingredient lists differ slightly in wording or completeness.
- NOT the same: genuinely distinct dishes, including authentic regional or preparation VARIATIONS that differ in DEFINING ingredients or technique (e.g. Thai vs Lao green papaya salad, which differ in core ingredients; a roux vs a béchamel, where one is an ingredient of the other).

Weigh the defining ingredients and cuisine, not just the name. Respond with a single JSON object and nothing else: {"same": true|false}.`;

/**
 * LLM adjudication for the dedup gray zone: are dish A and dish B the same dish?
 * Each argument is a short descriptor (canonical name, any alias, cuisine/tags,
 * ingredients).
 * Fails CLOSED (false) on any error so an LLM hiccup never merges distinct dishes.
 */
export async function adjudicateSameDish(
    dishA: string,
    dishB: string
): Promise<boolean> {
    try {
        const content = await generateCompletion({
            model: { openai: "gpt-4o-mini" },
            system: SYSTEM_PROMPT,
            user: `DISH A:\n${dishA}\n\nDISH B:\n${dishB}`,
            json: true,
            maxTokens: { openai: 10 },
        });

        if (!content) return false;
        return (JSON.parse(content) as { same?: boolean }).same === true;
    } catch (error) {
        console.error("[Suggestions] Dish adjudication failed:", error);
        return false;
    }
}
