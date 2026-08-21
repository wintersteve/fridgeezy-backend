import { randomUUID } from "node:crypto";

import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    PendingSuggestionDto,
    StreamedSuggestionDto,
    RejectedSuggestionRequestDto,
    WithdrawnSuggestionDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { canonicalizeName } from "@fridgeezy/toolkit";
import { z } from "zod/v4";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import {
    ADAPTED_FOR_RULE,
    BLACKLIST_RULE,
    FOOD_ONLY_RULE,
} from "./constraint-rules";
import { DIFFICULTY_RULE } from "./difficulty-rules";
import {
    buildExistingDishesBlock,
    listCatalogDishes,
} from "./list-catalog-dishes";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "./naming-rules";
import { persistOrReuseSuggestion } from "./persist-or-reuse-suggestion";
import { createSuggestionBatch, type SuggestionBatch } from "./suggestion-batch";
import type { SuggestionOutcome } from "./suggestion-outcome";
import {
    COMPONENT_FILTER_RULE,
    COMPONENT_RULE,
    COURSE_RULE,
    DISH_FORM_FILTER_RULE,
    DISH_FORM_RULE,
    TAGS_KEY_RULE,
} from "./tagging-rules";
import { DISH_TOTAL_TIME_RULE } from "./timing-rules";

/** How many cards one `/suggestions/generate` call aims to deliver. */
const SUGGESTIONS_PER_BATCH = 4;

/**
 * How many generation passes a request may take to reach that number.
 *
 * Two, not more: the second pass exists to refill slots that dedup collapsed,
 * and a third would keep paying LLM calls to chase a target the catalogue may
 * genuinely not have room for — a user deep into an infinite-scroll feed with a
 * narrow cuisine filter can legitimately run out of new dishes.
 */
const MAX_PASSES = 2;

/**
 * The suggestion system prompt, for a batch of `count` dishes.
 *
 * Parameterised because the top-up pass asks for exactly the shortfall rather
 * than a fresh four — requesting four and discarding three would pay for output
 * tokens nobody ever sees.
 */
/**
 * The one non-dish line the generator may emit: "this request is out of scope".
 *
 * Local to this module because it is an LLM-output contract, not a client one.
 * The frame the *client* eventually receives is
 * `RejectedSuggestionRequestSchema` in `@fridgeezy/schemas`, and the two are
 * deliberately separate types — this one is what a model can be trusted to
 * write, that one is what the API promises. Mapping between them is the job of
 * this file.
 *
 * `rejected` carries the reason directly rather than pairing a boolean with a
 * separate field: one key is one thing for the model to get right, and a line
 * that says `{"rejected":true}` with no reason would validate while telling us
 * nothing.
 */
const GeneratorRejectionSchema = z.object({
    rejected: z.literal("not_food"),
});

/** Index of {@link GeneratorRejectionSchema} in the schema list passed to the parser. */
const REJECTION_LINE = 1;

function buildSuggestionsSystemPrompt(count: number): string {
    return `You are a recipe suggestion assistant. Generate up to ${count} well-known, real-world recipe suggestion${count === 1 ? "" : "s"} based on the user's request.

The "Ingredients" line below may list literal ingredients, but it may ALSO be a dish name (e.g. "sandwich", "carbonara"), a meal or course concept (e.g. "breakfast", "quick dinner", "random recipe"), or a cuisine. Interpret it flexibly:
- Literal ingredients -> real dishes that prominently feature them.
- A dish name -> authentic variations of that dish (classic and regional versions).
- A meal/course or cuisine concept -> a varied set of authentic dishes that fit it.

## Rules
- BEING WELL KNOWN IS PARAMOUNT: only suggest dishes that people actually ask for BY NAME within their own food culture. Known locally is enough — a dish every household in Oaxaca can name qualifies; it does not have to be famous worldwide.
- Modern and fusion dishes are welcome when they are established in their own right (California Roll, Korean tacos, Banh Mi). Age and purity are not the test; recognition is.
- Each recipe MUST have a REAL NAME people use for it — never an invented or descriptive one (NOT "Indian Tomato Butter Chicken", NOT "Persian Chicken with Yogurt and Walnuts"). If the only way you can label a dish is by listing what is in it, it is not an established dish: leave it out and pick one that has a name. Do NOT add alternative names in parenthesis.
- Do NOT reach for obscure dishes to satisfy the exclusion list below. If the well-known dishes matching this request are already in the catalog, return FEWER dishes — even none. A short batch is correct; padding it with something nobody has heard of is not.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- EVERY DISH YOU RETURN MUST BE A DIFFERENT DISH. Never return a dish alongside a qualified version of itself ("Arancini" and "Arancini di Riso al Ragù"), a dish alongside its own base ("Haemul Pajeon" and "Pajeon"), or the same dish under two names ("Som Tam" and "Green Papaya Salad"). If a request only really supports one of them, pick the best one — fill the other slot with a genuinely different dish if you have one, and drop the slot if you do not.
  - A qualifier naming a DIFFERENT PREPARATION is not this case, and both dishes may be returned: "Arancini al Burro" is filled with béchamel, ham and provolone, which makes it a distinct Sicilian variety rather than a longer name for the ragù-filled original. THE TEST IS THE INGREDIENTS, not the length of the name — if the qualifier changes what is inside the dish, they are two dishes; if it only restates what is already there, they are one.
- ${COMPONENT_FILTER_RULE}
- ${DISH_FORM_FILTER_RULE}
- ${FOOD_ONLY_RULE}
- When the request is ONLY for drinks and there is no food dish to offer, output exactly one line and nothing else: {"rejected":"not_food"}. Say it explicitly rather than returning nothing — silence and "I found nothing this time" are indistinguishable downstream, and the user is told the wrong one.
- Return nothing at all only when there is genuinely nothing left to give: a truly incompatible INGREDIENT combination (e.g., rosemary in Thai cuisine), nonsensical input, or every well-known dish fitting the request already being in the catalog. Short of that, a real FOOD dish name, cuisine, or meal/course concept is satisfiable — do not return empty out of caution.
- If an "Already in the catalog" list is given, NEVER suggest a dish on it, nor a translation or spelling variant of one — the user already has those. Suggest a different well-known dish that still fits the request, or fewer dishes if there is no such dish left.

## Constraints
${BLACKLIST_RULE}

${DIFFICULTY_RULE}

## Tagging Rules (CRITICAL)
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin, as specific as you can be ("sichuan" rather than "chinese" for a Sichuanese dish). Add a SECOND only when the dish genuinely belongs to two traditions at once: Tex-Mex is american + mexican, Nikkei is japanese + peruvian, banh mi is vietnamese + french. Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- ${COURSE_RULE}
- ${DISH_FORM_RULE}
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Ingredients
- MUST be singular
- MUST be the plain ingredient name only — NEVER include parentheses or qualifiers (e.g. "chicken breast", NOT "chicken breast (boneless)")

## Output Format
Output AT MOST ${count} recipe${count === 1 ? "" : "s"}, one JSON object per line (JSONL format). Aim for ${count}; return fewer whenever reaching ${count} would mean including a dish that is not well known. No markdown, no code blocks, no extra text.

Each recipe object must include:
- ${DISH_NAME_RULE}
- ${DISH_NAME_ALT_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- ${DISH_TOTAL_TIME_RULE}
- ingredients (array of strings)
- ${TAGS_KEY_RULE}
- ${ADAPTED_FOR_RULE}`;
}

// Exported for the model-migration eval harness, which must send byte-identical
// prompts to every candidate — a copy in the eval would drift and invalidate the
// comparison. Distinct name because the services barrel re-exports this module.
export const SUGGESTIONS_SYSTEM_PROMPT = buildSuggestionsSystemPrompt(
    SUGGESTIONS_PER_BATCH
);

/**
 * Holds this dish's place in the list while it is checked.
 *
 * Carries no name, no description, nothing — see `PendingSuggestionSchema`. The
 * client draws a placeholder, and because the placeholder makes no claim, the
 * dish behind it is free to be renamed, deduped or rejected without anything on
 * screen having to contradict itself.
 */
function pendingSlot(tempId: string): PendingSuggestionDto {
    return { tempId, pending: true };
}

/**
 * `provider` overrides `LLM_PROVIDER` for this call only, which is how the two
 * providers get A/B'd in one process. It replaces the `client?: OpenAI` this took
 * before: that parameter could only ever inject an OpenAI client, so it was no
 * use for the Bedrock comparison it existed to enable.
 */
export async function* generateSuggestionsStream(
    request: GenerateSuggestionRequestDto,
    provider?: LlmProvider
): AsyncGenerator<
    | PendingSuggestionDto
    | StreamedSuggestionDto
    | WithdrawnSuggestionDto
    | RejectedSuggestionRequestDto
> {
    const userPrompt = buildSuggestionsUserPrompt(request);

    // One coordinator for the WHOLE request, spanning both passes: a top-up dish
    // has to dedup against the dishes the first pass produced, and most of those
    // are still mid-flight when it starts.
    const batch = createSuggestionBatch();

    // Everything the client is already showing. The catalogue lookup covers what
    // is in the database; `request.exclude` covers what the client put on screen
    // from anywhere else, including earlier batches of this same feed.
    const catalogNames = await listCatalogDishes(userPrompt);
    const clientExcluded = request.exclude ?? [];

    // Canonical keys of dishes that must NOT produce a card, either because the
    // client already shows them or because an earlier pass of THIS response did.
    // Keyed the same way the database keys `canonical_id`, so "Tarte Tatin" and
    // "tarte  tatin!" are one entry.
    const suppressed = new Set(
        clientExcluded.map(canonicalizeName).filter(Boolean) as string[]
    );
    /** Suggestion row ids this response has already sent a card for. */
    const emittedIds = new Set<string>();
    /** Names this response delivered, fed to the top-up pass as exclusions. */
    const emittedNames: string[] = [];
    /**
     * Set when a dish was dropped for being a drink.
     *
     * A property of the REQUEST rather than of the dish: the model answered
     * exactly what was asked, and what was asked is out of scope. Distinguished
     * from every other drop reason because it is the only one where asking again
     * is guaranteed to fail the same way.
     */
    let outOfScope = false;
    /**
     * How many dish lines the last pass actually wrote.
     *
     * The generator is now asked for AT MOST `count` and told to return fewer
     * rather than reach for something obscure, so a short pass is a statement:
     * every well-known dish fitting this request is already in the catalog.
     * Topping that up asks the same exhausted question again, and the only way
     * the model can answer differently is by going down the tail this whole
     * change exists to stop. So a short pass ends the request.
     */
    let generatedLastPass = 0;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const shortfall = SUGGESTIONS_PER_BATCH - emittedNames.length;
        if (shortfall <= 0) break;

        // The second pass only runs when dedup actually collapsed something, so
        // its cost is paid on the rare path rather than on every batch.
        if (pass > 0) {
            console.log(
                `[Suggestions] Topping up ${shortfall} slot${shortfall === 1 ? "" : "s"} collapsed by dedup`
            );
        }

        const exclusions = buildExistingDishesBlock([
            ...catalogNames,
            ...clientExcluded,
            ...emittedNames,
        ]);

        yield* runGenerationPass({
            count: shortfall,
            user: [userPrompt, exclusions].filter(Boolean).join("\n"),
            provider,
            request,
            batch,
            suppressed,
            emittedIds,
            onDelivered: (name) => emittedNames.push(name),
            onOutOfScope: () => {
                outOfScope = true;
            },
            onGenerated: (lines) => {
                generatedLastPass = lines;
            },
        });

        // Do NOT top up an out-of-scope request. The top-up exists to refill
        // slots that dedup collapsed — a case where asking again plausibly
        // returns something new. "Mojito" asked again returns a mojito, so a
        // second pass buys one more generation call plus another round of
        // authenticity calls to withdraw the same cards. This is the one drop
        // reason that must break the loop rather than drive it.
        //
        // Same for a pass that came back SHORT. It filled every slot it could
        // and stopped, which is the generator reporting saturation for this
        // request — asking again cannot produce a dish it just declined to name
        // without going down the tail. Only a pass that delivered a full `count`
        // of lines and then lost some to dedup is worth refilling.
        if (outOfScope || generatedLastPass < shortfall) break;
    }

    // Only when the request produced NOTHING. A request that yielded two real
    // dishes alongside a stray drink was satisfiable, and telling the user it
    // was rejected would contradict the cards already on their screen.
    if (outOfScope && emittedNames.length === 0) {
        console.log(
            "[Suggestions] Rejecting request — asked for drinks, which this catalog does not hold"
        );
        yield { rejected: true, reason: "not_food" };
    }
}

interface GenerationPassOptions {
    count: number;
    user: string;
    provider?: LlmProvider;
    request: GenerateSuggestionRequestDto;
    batch: SuggestionBatch;
    suppressed: Set<string>;
    emittedIds: Set<string>;
    onDelivered: (name: string) => void;
    /** Called when a dish was dropped as a drink — see `outOfScope` above. */
    onOutOfScope: () => void;
    /** How many dish lines the model wrote — see `generatedLastPass` above. */
    onGenerated: (lines: number) => void;
}


/**
 * One model call: stream its JSONL lines, persist each concurrently, and yield
 * the frames.
 *
 * Persist/dedup each suggestion CONCURRENTLY: the work starts as soon as its
 * JSONL line is parsed, rather than one at a time. Each suggestion's dedup +
 * authenticity + ingredient/tag matching is independent; the only shared writes
 * are new ingredient/tag rows, and their creates are conflict-safe (reuse the row
 * that wins a duplicate-key race). What the concurrency used to cost — siblings
 * being invisible to each other's dedup — is now handled in memory by the shared
 * {@link SuggestionBatch}, so it no longer has to be paid for in duplicate rows.
 *
 * Consumption and yielding are interleaved. An earlier version drained the model
 * stream completely before entering a second loop that yielded — so however
 * concurrent the persistence was, the first card could not reach the client until
 * the LAST suggestion had been generated. Measured, that put every card at ~9.9s
 * when the first was ready at ~7.8s.
 *
 * Order is still generation order: `pending` is consumed from the front, so a
 * fast fourth suggestion never overtakes a slow first one. That matters because
 * the client renders the batch as an ordered list.
 */
async function* runGenerationPass({
    count,
    user,
    provider,
    request,
    batch,
    suppressed,
    emittedIds,
    onDelivered,
    onOutOfScope,
    onGenerated,
}: GenerationPassOptions): AsyncGenerator<
    PendingSuggestionDto | StreamedSuggestionDto | WithdrawnSuggestionDto
> {
    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "suggestions.batch",
        system: buildSuggestionsSystemPrompt(count),
        user,
        provider,
    });

    /**
     * How many dish lines this pass produced.
     *
     * Separate from "how many survived". A pass that wrote four dishes and had
     * all four collapsed by dedup SHOULD top up — that is what the second pass
     * is for. A pass that wrote fewer than it was asked for is reporting that
     * the well-known dishes for this request are exhausted, and topping that up
     * only pushes it into the tail.
     */
    let generatedLines = 0;

    const pending: Promise<{
        outcome: SuggestionOutcome;
        tempId: string;
        /** Per-request, so it can only come from the frame the model wrote. */
        adaptedFor?: string[];
    }>[] = [];
    // Two line shapes, and the order matters: `processJsonlStream` reports the
    // index of the FIRST schema that matched, so the rejection line is second
    // and stays unambiguous — a dish never validates against it.
    const source = processJsonlStream(stream, [
        GenerateSuggestionResponseSchema,
        GeneratorRejectionSchema,
    ]);
    let done = false;

    const emit = function* (
        outcome: SuggestionOutcome,
        tempId: string,
        adaptedFor?: string[]
    ): Generator<StreamedSuggestionDto | WithdrawnSuggestionDto> {
        // Every dish has a placeholder on screen from the moment it was
        // generated, so every drop has one to take away. No conditional.
        const withdraw = function* (): Generator<WithdrawnSuggestionDto> {
            yield { tempId, withdrawn: true };
        };

        // A dish the user already has as a recipe is not surfaced: this endpoint
        // returns suggestion cards, and re-offering something already in the
        // catalog is exactly the duplication being guarded against. The prompt
        // exclusion above makes this a rare fallback.
        //
        // Withdrawn rather than silently skipped when a card was already sent —
        // saying nothing would leave a card on screen that never resolves and
        // cannot be opened.
        if (outcome.kind === "existing_recipe") {
            console.log(
                `[Suggestions] Withdrawing "${outcome.recipe.name}" — already in the catalog as a recipe`
            );
            yield* withdraw();
            return;
        }

        // Same for a dish the authenticity gate rejected, and for one the batch
        // coordinator collapsed into an earlier sibling.
        //
        // A drink is reported upward as well, because it is the one reason that
        // says something about the REQUEST rather than about this dish. The
        // caller uses that to stop topping up and to send the terminal frame —
        // and it must still happen when nothing was drawn, since the gate now
        // rejects the drink before any card exists.
        if (outcome.kind === "dropped") {
            if (outcome.reason === "not_food") onOutOfScope();
            yield* withdraw();
            return;
        }

        // Dedup resolving to an EXISTING suggestion row is a success, not a
        // duplicate — unless this response already showed that row, or the
        // client says it is already on screen. Then emitting it renders the same
        // dish a second time under a different tempId, with an identical `id`
        // the client has no reason to reconcile.
        //
        // This is the visible half of the duplicate-card bug: the database
        // dedup was working, and its result was being drawn as a new card
        // anyway.
        const { id, name } = outcome.suggestion;
        const key = canonicalizeName(name);

        if (emittedIds.has(id) || (key && suppressed.has(key))) {
            console.log(
                `[Suggestions] Withdrawing "${name}" — already shown in this feed`
            );
            yield* withdraw();
            return;
        }

        emittedIds.add(id);
        if (key) suppressed.add(key);
        onDelivered(name);

        // Carries the same tempId as the provisional card, which is how the
        // client replaces it rather than appending a second one.
        //
        // `adaptedFor` rides along from the model's frame rather than the
        // persisted row: the row is shared by dedup, the adaptation is not.
        yield { ...outcome.suggestion, tempId, adaptedFor };
    };

    while (!done || pending.length > 0) {
        if (!done) {
            const next = await source.next();

            if (next.done) {
                done = true;
            } else if (next.value.schemaIndex === REJECTION_LINE) {
                // The generator declined the request rather than producing a
                // dish. Reported through the same channel the gate uses, so the
                // caller has one thing to react to. Neither draws a card any
                // more — the gate's version used to arrive after four had been
                // drawn and withdrawn — so now they differ only in cost: this
                // one is caught for free, the gate's costs a review call each.
                console.log(
                    "[Suggestions] Generator declined the request — asked for drinks"
                );
                onOutOfScope();
            } else {
                generatedLines++;
                const suggestion = next.value.parsed as GenerateSuggestionResponseDto;
                const tempId = randomUUID();

                pending.push(
                    persistOrReuseSuggestion(suggestion, request, { batch }).then(
                        (outcome) => ({
                            outcome,
                            tempId,
                            adaptedFor: suggestion.adaptedFor,
                        })
                    )
                );

                // Reserve this dish's place the instant the model names it, and
                // say nothing about it. The client draws a placeholder, so the
                // list shows exactly as many pending slots as there are dishes
                // in flight — not a guessed batch size — and the dish behind it
                // stays free to be renamed by the review or removed by dedup
                // without anything on screen having to change its mind.
                yield pendingSlot(tempId);
            }
        }

        // Drain everything already settled before reading more from the model,
        // so a card is never held back behind a line still being generated.
        //
        // Order is still generation order: `pending` is consumed from the front,
        // so a fast fourth suggestion never overtakes a slow first one. That
        // matters because the client renders the batch as an ordered list.
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

    onGenerated(generatedLines);
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
