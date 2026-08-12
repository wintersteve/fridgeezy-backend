import { generateCompletion } from "@fridgeezy/llm";

const SYSTEM_PROMPT = `You decide whether two dish descriptions refer to the SAME dish for a recipe database.

- "same": they are the same dish — the same recipe under a different name, a translation or transliteration of the native name, or a trivial spelling variant (e.g. "Som Tam" and "Green Papaya Salad"; "Murgh Makhani" and "Butter Chicken"). A native-language name and its English translation of the SAME dish are ALWAYS "same", even if the two ingredient lists differ slightly in wording or completeness.
- NOT the same: genuinely distinct dishes, including authentic regional or preparation VARIATIONS that differ in DEFINING ingredients or technique (e.g. Thai vs Lao green papaya salad, which differ in core ingredients; a roux vs a béchamel, where one is an ingredient of the other).

Weigh the defining ingredients and cuisine, not just the name. Respond with a single JSON object and nothing else: {"same": true|false}.`;

export interface AdjudicateOptions {
    /**
     * What to answer when the call fails. Defaults to `false` — fail CLOSED, so
     * an LLM hiccup never merges two distinct dishes.
     *
     * Pass `true` only when the two dishes share a canonical NAME. Until
     * `20260812000003` that case could not produce a duplicate at all:
     * `recipe_suggestions.canonical_id` was unique outright, so a same-name pair
     * merged unconditionally and the database was the backstop for any
     * adjudicator error. Making identity `(canonical_id, identity_cuisine)`
     * removed that backstop — a "not same" answer now INSERTS, and the result is
     * a permanent duplicate that nothing collapses and that `listCatalogDishes`
     * feeds back to the generator forever.
     *
     * So the failure directions are not symmetric, and neither is a free choice:
     *
     * - fail closed on a same-name pair -> a duplicate row, no recovery path.
     * - fail open on a same-name pair -> one dish merged into another, which is
     *   exactly what shipped before this column existed, and is recoverable by
     *   splitting the row later.
     *
     * An error in new machinery must not produce an outcome the old system could
     * never produce. That is the whole rule.
     */
    onError?: boolean;
}

/**
 * LLM adjudication for the dedup gray zone: are dish A and dish B the same dish?
 * Each argument is a short descriptor (canonical name, any alias, cuisine/tags,
 * ingredients).
 */
export async function adjudicateSameDish(
    dishA: string,
    dishB: string,
    options: AdjudicateOptions = {}
): Promise<boolean> {
    const { onError = false } = options;

    try {
        const { text: content } = await generateCompletion({
            model: { openai: "gpt-4o-mini" },
            label: "adjudicate.dish",
            system: SYSTEM_PROMPT,
            user: `DISH A:\n${dishA}\n\nDISH B:\n${dishB}`,
            json: true,
            // The two numbers are not conversions of each other. 10 is ample for
            // `{"same":true}` from a model that answers immediately; a thinking
            // model spends that before emitting any visible text, and Anthropic
            // rejects a cap that doesn't clear the thinking budget. 1024 clears
            // a low-effort pass on a one-bit judgement with room to spare, and is
            // 32x tighter than the streaming fallback this used to inherit.
            maxTokens: { openai: 10, bedrock: 1024 },
            // Cheapest setting that still leaves thinking on: a leaked
            // `<thinking>` tag makes this unparseable, and the catch below fails
            // closed, so a leak here quietly stops merging dishes that should
            // merge. Adaptive stays; only the depth comes down.
            effort: "low",
        });

        if (!content) return onError;
        return (JSON.parse(content) as { same?: boolean }).same === true;
    } catch (error) {
        console.error(
            `[Suggestions] Dish adjudication failed, answering "${onError ? "same" : "not same"}":`,
            error
        );
        return onError;
    }
}
