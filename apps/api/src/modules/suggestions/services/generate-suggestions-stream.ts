import { randomUUID } from "node:crypto";

import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    StreamedSuggestionDto,
    RejectedSuggestionRequestDto,
    SuggestionSlotsDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import {
    ADAPTED_FOR_RULE,
    BLACKLIST_RULE,
    FOOD_ONLY_RULE,
    WELL_KNOWN_RULE,
} from "./constraint-rules";
import { DIFFICULTY_RULE } from "./difficulty-rules";
import { createFrameQueue, createGate } from "./frame-queue";
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
import { createSlotLedger, type SlotLedger } from "./slot-ledger";
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
${WELL_KNOWN_RULE}
- Do NOT add alternative names in parenthesis.
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


/** Everything this endpoint can put on the wire. */
type SuggestionFrame =
    | SuggestionSlotsDto
    | StreamedSuggestionDto
    | RejectedSuggestionRequestDto;

/**
 * `provider` overrides `LLM_PROVIDER` for this call only, which is how the two
 * providers get A/B'd in one process. It replaces the `client?: OpenAI` this took
 * before: that parameter could only ever inject an OpenAI client, so it was no
 * use for the Bedrock comparison it existed to enable.
 */
export async function* generateSuggestionsStream(
    request: GenerateSuggestionRequestDto,
    provider?: LlmProvider
): AsyncGenerator<SuggestionFrame> {
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

    const ledger = createSlotLedger(clientExcluded);
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
        const shortfall = SUGGESTIONS_PER_BATCH - ledger.count;
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
            ...ledger.names,
        ]);

        yield* runGenerationPass({
            count: shortfall,
            user: [userPrompt, exclusions].filter(Boolean).join("\n"),
            provider,
            request,
            batch,
            ledger,
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
        // authenticity calls to drop the same dishes. This is the one drop
        // reason that must break the loop rather than drive it.
        //
        // Same for a pass that came back SHORT. It filled every slot it could
        // and stopped, which is the generator reporting saturation for this
        // request — asking again cannot produce a dish it just declined to name
        // without going down the tail. Only a pass that delivered a full `count`
        // of lines and then lost some to dedup is worth refilling.
        const saturated = outOfScope || generatedLastPass < shortfall;
        const willTopUp =
            !saturated &&
            pass + 1 < MAX_PASSES &&
            ledger.count < SUGGESTIONS_PER_BATCH;

        // Now the pass can be reported. A top-up about to run means the batch is
        // still working towards the full four, and saying "one card" here would
        // empty the list of skeletons and leave it sitting on a single card for
        // however long that pass takes.
        ledger.aimFor(willTopUp ? SUGGESTIONS_PER_BATCH : null);

        const answer = ledger.frame(true);
        if (answer) yield answer;

        if (saturated) break;
    }

    // Only when the request produced NOTHING. A request that yielded two real
    // dishes alongside a stray drink was satisfiable, and telling the user it
    // was rejected would contradict the cards already on their screen.
    if (outOfScope && ledger.count === 0) {
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
    /** Request-scoped, so a top-up pass adds to the count rather than restarting it. */
    ledger: SlotLedger;
    /** Called when a dish was dropped as a drink — see `outOfScope` above. */
    onOutOfScope: () => void;
    /** How many dish lines the model wrote — see `generatedLastPass` above. */
    onGenerated: (lines: number) => void;
}

/**
 * One model call: stream its JSONL lines, judge each concurrently, and yield the
 * frames.
 *
 * Three things run at once and they cannot be collapsed into one loop, which is
 * why this is built around a queue rather than around `yield` alone:
 *
 * - **Lines are read** as the model writes them, each starting its own
 *   `persistOrReuseSuggestion` immediately. Their dedup, authenticity and
 *   ingredient matching are independent; the only shared writes are new
 *   ingredient/tag rows, whose creates are conflict-safe. What the concurrency
 *   used to cost — siblings being invisible to each other's dedup — is handled
 *   in memory by the shared {@link SuggestionBatch}.
 * - **Slots are announced out of order**, the instant each dish is admitted.
 *   This is the part a single loop got wrong. Cards must go out in generation
 *   order, so a loop that also owned the slot count could not report dish four's
 *   admission until dish one's had landed — and one slow gate call (they range
 *   from 0.7s to 5.5s) would hold the whole count back past the moment the
 *   client stops showing its interstitial. Announcing admissions as they happen
 *   is what makes the skeleton count right at the only moment it matters.
 * - **Cards are emitted in generation order**, front of the queue first, so a
 *   fast fourth dish never overtakes a slow first one. The client renders the
 *   batch as an ordered list.
 *
 * Consumption and yielding stay interleaved, which an earlier version got wrong
 * in the other direction: it drained the model stream completely before entering
 * a second loop that yielded, so however concurrent the persistence was, the
 * first card could not reach the client until the LAST dish had been generated.
 * Measured, that put every card at ~9.9s when the first was ready at ~7.8s.
 */
async function* runGenerationPass({
    count,
    user,
    provider,
    request,
    batch,
    ledger,
    onOutOfScope,
    onGenerated,
}: GenerationPassOptions): AsyncGenerator<SuggestionFrame> {
    const queue = createFrameQueue<SuggestionFrame>();

    const push = (frame: SuggestionFrame | null) => {
        if (frame) queue.push(frame);
    };

    /**
     * Turn one settled outcome into the frames it owes the client.
     *
     * Most outcomes owe nothing. A dish dropped by the gate or collapsed by
     * dedup never held a slot, so there is nothing on screen to correct — which
     * is the whole point of admitting late.
     */
    const framesFor = (
        outcome: SuggestionOutcome,
        tempId: string,
        adaptedFor?: string[]
    ): SuggestionFrame[] => {
        // A dish the user already has as a recipe is not surfaced: this endpoint
        // returns suggestion cards, and re-offering something already in the
        // catalog is exactly the duplication being guarded against. The prompt
        // exclusion above makes this a rare fallback.
        if (outcome.kind === "existing_recipe") {
            console.log(
                `[Suggestions] Skipping "${outcome.recipe.name}" — already in the catalog as a recipe`
            );
            return [];
        }

        if (outcome.kind === "dropped") {
            // A drink is reported upward, because it is the one reason that says
            // something about the REQUEST rather than about this dish. The
            // caller uses it to stop topping up and to send the terminal frame.
            if (outcome.reason === "not_food") onOutOfScope();

            // `persist_failed` is the only drop that can follow an admission —
            // every other one happens before the dish is certain. Give the slot
            // back so the client stops holding a skeleton for it.
            if (ledger.isAdmitted(tempId)) {
                ledger.retract(tempId);

                const frame = ledger.frame();
                return frame ? [frame] : [];
            }

            return [];
        }

        // Admitted or suppressed was decided when the ledger saw this dish. A
        // miss here means it was already on screen and was never counted.
        if (!ledger.isAdmitted(tempId)) return [];

        ledger.deliver(tempId, outcome.suggestion.id);

        return [{ ...outcome.suggestion, tempId, adaptedFor }];
    };

    const produce = async () => {
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "suggestions.batch",
            system: buildSuggestionsSystemPrompt(count),
            user,
            provider,
        });

        // Two line shapes, and the order matters: `processJsonlStream` reports
        // the index of the FIRST schema that matched, so the rejection line is
        // second and stays unambiguous — a dish never validates against it.
        const source = processJsonlStream(stream, [
            GenerateSuggestionResponseSchema,
            GeneratorRejectionSchema,
        ]);

        /**
         * How many dish lines this pass produced.
         *
         * Separate from "how many survived". A pass that wrote four dishes and
         * had all four collapsed by dedup SHOULD top up — that is what the
         * second pass is for. A pass that wrote fewer than it was asked for is
         * reporting that the well-known dishes for this request are exhausted,
         * and topping that up only pushes it into the tail.
         */
        let generatedLines = 0;
        let linesDone = false;

        const judged: Promise<{
            outcome: SuggestionOutcome;
            tempId: string;
            /** Per-request, so it can only come from the frame the model wrote. */
            adaptedFor?: string[];
        }>[] = [];
        const arrivals = createGate();

        const readLines = async () => {
            try {
                for (;;) {
                    const next = await source.next();
                    if (next.done) break;

                    if (next.value.schemaIndex === REJECTION_LINE) {
                        // The generator declined the request rather than
                        // producing a dish. Reported through the same channel
                        // the gate uses, so the caller has one thing to react
                        // to. Neither draws a card — this one is caught for
                        // free, the gate's costs a review call each.
                        console.log(
                            "[Suggestions] Generator declined the request — asked for drinks"
                        );
                        onOutOfScope();
                        continue;
                    }

                    generatedLines++;

                    const suggestion = next.value
                        .parsed as GenerateSuggestionResponseDto;
                    const tempId = randomUUID();

                    judged.push(
                        persistOrReuseSuggestion(suggestion, request, {
                            batch,
                            onAdmit: (admission) => {
                                ledger.admit(tempId, admission);
                                push(ledger.frame());
                            },
                        }).then((outcome) => ({
                            outcome,
                            tempId,
                            adaptedFor: suggestion.adaptedFor,
                        }))
                    );

                    arrivals.open();
                }
            } finally {
                linesDone = true;
                arrivals.open();
            }
        };

        const emitCards = async () => {
            for (let i = 0; ; i++) {
                // No `await` between the test and the wait, so a line arriving
                // in between cannot be missed.
                while (i >= judged.length) {
                    if (linesDone) return;
                    await arrivals.next();
                }

                const settled = await judged[i];

                for (const frame of framesFor(
                    settled.outcome,
                    settled.tempId,
                    settled.adaptedFor
                )) {
                    push(frame);
                }
            }
        };

        // `emitCards` returns once it has consumed every line `readLines`
        // produced, so this resolving means every dish of this pass has been
        // judged. The `verified` frame that says so is sent by the CALLER, not
        // here: whether a top-up pass follows is its decision, and that decides
        // whether the count it reports is the batch's answer or just its
        // progress so far.
        await Promise.all([readLines(), emitCards()]);

        onGenerated(generatedLines);
    };

    const producer = produce().finally(() => queue.close());

    yield* queue.drain();

    // Surface a failure that happened while the queue was being drained. The
    // drain itself ends cleanly on `close()`, so without this a model or
    // database error would look like an empty batch.
    await producer;
}
