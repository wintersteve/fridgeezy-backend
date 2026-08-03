import { randomUUID } from "node:crypto";

import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    ProvisionalSuggestionDto,
    StreamedSuggestionDto,
    WithdrawnSuggestionDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import { ADAPTED_FOR_RULE, BLACKLIST_RULE } from "./constraint-rules";
import {
    buildExistingDishesBlock,
    listCatalogDishes,
} from "./list-catalog-dishes";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "./naming-rules";
import {
    persistOrReuseSuggestion,
    SuggestionOutcome,
} from "./persist-or-reuse-suggestion";

// Exported for the model-migration eval harness, which must send byte-identical
// prompts to every candidate — a copy in the eval would drift and invalidate the
// comparison. Distinct name because the services barrel re-exports this module.
export const SUGGESTIONS_SYSTEM_PROMPT = `You are a recipe suggestion assistant. Generate exactly 4 authentic, real-world recipe suggestions based on the user's request.

The "Ingredients" line below may list literal ingredients, but it may ALSO be a dish name (e.g. "sandwich", "carbonara"), a meal or course concept (e.g. "breakfast", "quick dinner", "random recipe"), or a cuisine. Interpret it flexibly:
- Literal ingredients -> real dishes that prominently feature them.
- A dish name -> authentic variations of that dish (classic and regional versions).
- A meal/course or cuisine concept -> a varied set of authentic dishes that fit it.

## Rules
- AUTHENTICITY IS PARAMOUNT: Only suggest real, well-documented recipes that exist in culinary traditions.
- Each recipe MUST be a genuine, documented dish — never an invented or descriptive name (e.g., NOT "Indian Tomato Butter Chicken"). Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- Only return an empty array when the request genuinely cannot be satisfied authentically — a truly incompatible INGREDIENT combination (e.g., rosemary in Thai cuisine) or nonsensical input. A real dish name, cuisine, or meal/course concept is ALWAYS satisfiable, so NEVER return an empty array for those.
- If an "Already in the catalog" list is given, NEVER suggest a dish on it, nor a translation or spelling variant of one — the user already has those. Suggest a different authentic dish that still fits the request.

## Constraints
${BLACKLIST_RULE}

## Difficulty Levels
- "easy": The standard, most authentic version of the dish with all traditional techniques and essential ingredients.
- "medium": An elevated but authentic version with refined techniques or premium ingredient variations.
- "hard": A sophisticated, chef-level authentic interpretation featuring advanced techniques or upscale variations.

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe:
  - Use the specific component type if it matches (e.g., roux for a roux, sauce for bechamel, stock for a stock)
  - Use "dish" for regular finished dishes/meals
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin, as specific as you can be ("sichuan" rather than "chinese" for a Sichuanese dish). Add a SECOND only when the dish genuinely belongs to two traditions at once: Tex-Mex is american + mexican, Nikkei is japanese + peruvian, banh mi is vietnamese + french. Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe. The ONLY valid course tags are: appetizer, dessert, main, side. Pick exactly one of those four — a main dish is "main", a starter is "appetizer", an accompaniment is "side". Never omit it, and never invent another (not "dinner", "lunch", "breakfast", "entree" or "main course").
- AT MOST 1 dish form tag per recipe, and only when the dish clearly IS one: soup, stew, salad, sandwich, wrap, pizza, pasta, noodles, curry, stir fry, roast, bake, casserole, grill, pie, dumpling, rice dish, porridge, pancake, skewer. This is the SHAPE of the dish, not when it is served — a soup served first is still course "appetizer" and form "soup". Omit it entirely for a dish that is simply a plate of food; most dishes have no form.
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Ingredients
- MUST be singular
- MUST be the plain ingredient name only — NEVER include parentheses or qualifiers (e.g. "chicken breast", NOT "chicken breast (boneless)")

## Output Format
Output EXACTLY 4 recipes, one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

Each recipe object must include:
- ${DISH_NAME_RULE}
- ${DISH_NAME_ALT_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- ingredients (array of strings)
- tags (array of strings with component, cuisine, and dietary tags)
- ${ADAPTED_FOR_RULE}`;

/**
 * `provider` overrides `LLM_PROVIDER` for this call only, which is how the two
 * providers get A/B'd in one process. It replaces the `client?: OpenAI` this took
 * before: that parameter could only ever inject an OpenAI client, so it was no
 * use for the Bedrock comparison it existed to enable.
 */
/**
 * The card as the model wrote it, before any database work.
 *
 * Ingredient and tag ids do not exist yet — the rows may not either. They are
 * synthesised with a `temp:` prefix so the shape matches the enriched frame and
 * the client needs one type, not two, and so React keys stay stable and unique
 * within the card. Nothing should treat them as real ids; they are visibly not
 * UUIDs, and the enriched frame replaces them a few seconds later.
 */
function provisionalCard(
    suggestion: GenerateSuggestionResponseDto,
    tempId: string
): ProvisionalSuggestionDto {
    const provisional = (name: string) => ({ id: `temp:${name}`, name });

    return {
        tempId,
        name: suggestion.name,
        nameEn: suggestion.name_alt,
        description: suggestion.description,
        difficulty: suggestion.difficulty,
        ingredients: suggestion.ingredients.map(provisional),
        tags: suggestion.tags.map(provisional),
        adaptedFor: suggestion.adaptedFor,
    };
}

export async function* generateSuggestionsStream(
    request: GenerateSuggestionRequestDto,
    provider?: LlmProvider
): AsyncGenerator<
    ProvisionalSuggestionDto | StreamedSuggestionDto | WithdrawnSuggestionDto
> {
    const userPrompt = buildSuggestionsUserPrompt(request);
    const existingDishes = buildExistingDishesBlock(
        await listCatalogDishes(userPrompt)
    );

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        system: SUGGESTIONS_SYSTEM_PROMPT,
        user: [userPrompt, existingDishes].filter(Boolean).join("\n"),
        provider,
    });

    // Persist/dedup each suggestion CONCURRENTLY: the work starts as soon as its
    // JSONL line is parsed, rather than one at a time. Each suggestion's dedup +
    // authenticity + ingredient/tag matching is independent; the only shared
    // writes are new ingredient/tag rows, and their creates are conflict-safe
    // (reuse the row that wins a duplicate-key race).
    //
    // Consumption and yielding are interleaved. An earlier version drained the
    // model stream completely before entering a second loop that yielded — so
    // however concurrent the persistence was, the first card could not reach the
    // client until the LAST suggestion had been generated. Measured, that put
    // every card at ~9.9s when the first was ready at ~7.8s.
    //
    // Order is still generation order: `pending` is consumed from the front, so
    // a fast fourth suggestion never overtakes a slow first one. That matters
    // because the client renders the batch as an ordered list.
    const pending: Promise<{
        outcome: SuggestionOutcome;
        tempId: string;
        /** Per-request, so it can only come from the frame the model wrote. */
        adaptedFor?: string[];
    }>[] = [];
    const source = processJsonlStream(stream, [GenerateSuggestionResponseSchema]);
    let done = false;

    const emit = function* (
        outcome: SuggestionOutcome,
        tempId: string,
        adaptedFor?: string[]
    ): Generator<StreamedSuggestionDto | WithdrawnSuggestionDto> {
        // A dish the user already has as a recipe is not surfaced: this endpoint
        // returns suggestion cards, and re-offering something already in the
        // catalog is exactly the duplication being guarded against. The prompt
        // exclusion above makes this a rare fallback.
        //
        // Withdrawn rather than silently skipped, because its provisional card
        // has already been sent — saying nothing would leave a card on screen
        // that never resolves and cannot be opened.
        if (outcome.kind === "existing_recipe") {
            console.log(
                `[Suggestions] Withdrawing "${outcome.recipe.name}" — already in the catalog as a recipe`
            );
            yield { tempId, withdrawn: true };
            return;
        }

        // Same for a dish the authenticity gate rejected.
        if (outcome.kind === "dropped") {
            yield { tempId, withdrawn: true };
            return;
        }

        // Carries the same tempId as the provisional card, which is how the
        // client replaces it rather than appending a second one.
        if (outcome.kind === "suggestion") {
            // `adaptedFor` rides along from the model's frame rather than the
            // persisted row: the row is shared by dedup, the adaptation is not.
            yield { ...outcome.suggestion, tempId, adaptedFor };
        }
    };

    while (!done || pending.length > 0) {
        if (!done) {
            const next = await source.next();

            if (next.done) {
                done = true;
            } else {
                const suggestion = next.value.parsed as GenerateSuggestionResponseDto;
                const tempId = randomUUID();

                pending.push(
                    persistOrReuseSuggestion(suggestion, request).then(
                        (outcome) => ({
                            outcome,
                            tempId,
                            adaptedFor: suggestion.adaptedFor,
                        })
                    )
                );

                // The card the model just wrote, sent before any database work.
                // Everything after this point — embedding, three dedup searches,
                // ingredient/tag matching, the insert — takes ~3.5s and changes
                // nothing the user can see except resolving ids. Holding the
                // card back for it was most of the wait.
                yield provisionalCard(suggestion, tempId);
            }
        }

        // Drain everything already settled before reading more from the model,
        // so a card is never held back behind a line still being generated.
        while (
            pending.length > 0 &&
            (done || (await isSettled(pending[0])))
        ) {
            const settled = await pending.shift();

            if (settled) {
                yield* emit(
                    settled.outcome,
                    settled.tempId,
                    settled.adaptedFor
                );
            }
        }
    }
}

/**
 * Whether a promise has already resolved, without waiting on it.
 *
 * Used to decide "is the next card ready *now*" while the model is still
 * producing lines. `Promise.race` against an already-resolved sentinel settles
 * in one microtask, so this never delays reading the next line.
 */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
    const pendingMarker = Symbol("pending");

    return (await Promise.race([promise, Promise.resolve(pendingMarker)])) !==
        pendingMarker;
}
