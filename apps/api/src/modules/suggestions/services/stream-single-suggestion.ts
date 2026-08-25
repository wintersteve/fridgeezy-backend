import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseSchema,
    type GenerateSuggestionResponseDto,
} from "@fridgeezy/schemas";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import {
    ADAPTED_FOR_RULE,
    BLACKLIST_RULE,
    FOOD_ONLY_RULE,
    WELL_KNOWN_RULE,
} from "./constraint-rules";
import { DIFFICULTY_RULE } from "./difficulty-rules";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "./naming-rules";
import {
    persistOrReuseSuggestion,
    SuggestionOutcome,
} from "./persist-or-reuse-suggestion";
import {
    accumulateSuggestionReveals,
    type PartialSuggestionFields,
} from "./suggestion-reveals";
import {
    COMPONENT_FILTER_RULE,
    COMPONENT_RULE,
    COURSE_RULE,
    DISH_FORM_FILTER_RULE,
    DISH_FORM_RULE,
    TAGS_KEY_RULE,
} from "./tagging-rules";
import { DISH_TOTAL_TIME_RULE } from "./timing-rules";

/**
 * The visible-first key order the model must emit so the card reveals fields in
 * a natural order: title, then description, then difficulty, then the chips.
 * `name_alt` trails since it's only needed for persistence, not the card.
 *
 * `total_time_minutes` sits immediately after `difficulty` because that is where
 * it is DRAWN — the time pill and the difficulty pill are the same row of the
 * card, so revealing them together avoids the row visibly growing a second chip
 * a beat later.
 */
const SYSTEM_PROMPT = `You are a recipe suggestion assistant. Generate exactly ONE authentic, real-world recipe suggestion based on the user's request.

The "Ingredients" line below may list literal ingredients, but it may ALSO be a dish name (e.g. "sandwich", "carbonara"), a meal or course concept (e.g. "breakfast", "quick dinner", "random recipe"), or a cuisine. Interpret it flexibly:
- Literal ingredients -> a real dish that prominently features them.
- A dish name -> an authentic version of that dish.
- A meal/course or cuisine concept -> one authentic dish that fits it.

## Rules
- WHEN A "Dish:" LINE IS PRESENT, the user asked for THAT DISH BY NAME. Return that dish itself. Do NOT return a dish that CONTAINS it, is served with it, or is built on it — asked for "Ragu" return the ragù, never Tagliatelle al Ragù or Lasagne; asked for "Bechamel" return the béchamel, never a gratin; asked for "Pesto" return the pesto, never Trofie al Pesto. This bites hardest on a dish that is also an INGREDIENT of other dishes, which is exactly when the temptation to answer with the finished plate is strongest. The one thing you may change is the name: return the dish under the name it is properly known by.
${WELL_KNOWN_RULE}
- Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- ${COMPONENT_FILTER_RULE}
- ${DISH_FORM_FILTER_RULE}
- ${FOOD_ONLY_RULE}
- If the request cannot be satisfied authentically under these constraints, pick the closest authentic dish that does satisfy them. The one exception is a request for a DRINK: there, return nothing rather than reaching for the closest food.

## Constraints
${BLACKLIST_RULE}

${DIFFICULTY_RULE}

## Tagging Rules (CRITICAL)
- ${COMPONENT_RULE}
- EXACTLY 1 cuisine tag (the most accurate cuisine origin).
- ${COURSE_RULE}
- ${DISH_FORM_RULE}
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies).

## Ingredients
- MUST be singular.

## Output Format
Output EXACTLY ONE JSON object. No markdown, no code blocks, no extra text.
Emit the keys in EXACTLY this order:
- ${DISH_NAME_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- ${DISH_TOTAL_TIME_RULE}
- ingredients (array of strings)
- ${TAGS_KEY_RULE}
- ${DISH_NAME_ALT_RULE}
- ${ADAPTED_FOR_RULE}`;

export interface StreamSingleSuggestionOptions {
    /**
     * The dish the user named, pinned so the generator returns THAT DISH.
     *
     * Deliberately not part of `GenerateSuggestionRequestDto`: the caller used
     * to pass a named dish as `ingredients: [dish]`, which renders as
     * `Ingredients: Ragu` — and a ragù genuinely IS an ingredient of other
     * dishes, so the generator read it as "a dish featuring ragù" and answered
     * with Tagliatelle al Ragù. It was doing what it was asked. A dish is not an
     * ingredient and must not be handed over on the ingredients line.
     *
     * Backend-local rather than a schema field so this needs no tarball rebuild;
     * it is a property of THIS call, not of the shared request contract.
     */
    dish?: string;
    /**
     * Overrides `LLM_PROVIDER` for this call only, so the two providers can be
     * A/B'd in one process. Replaces the `client?: OpenAI` this took before,
     * which could only inject an OpenAI client and so could not express the
     * comparison it existed for.
     */
    provider?: LlmProvider;
    /**
     * Called each time a new top-level field finishes streaming, with every
     * field known so far. Lets a caller reveal the card field-by-field.
     */
    onField?: (fields: PartialSuggestionFields) => void;
    /**
     * Called once, the instant the dish has CLEARED THE NOTABILITY GATE and
     * before the embedding, the dedup layers and the persist — several seconds
     * in which the dish is completely known and nothing has committed it yet. A
     * caller that only needs the dish's WORDS starts here rather than waiting
     * for an id.
     *
     * **It used to fire one step earlier, on the raw parsed object, and that was
     * a real defect rather than a nuance.** Chat starts writing its summary from
     * this callback, so a dish the review then dropped produced a finished
     * paragraph about a dish the reader never saw — followed by a card that
     * never arrived and "Something went wrong". See `onReviewed` on
     * `PersistOrReuseOptions`.
     *
     * Still not a commitment that this dish survives: dedup can resolve it onto
     * an existing row under another name, and the write can fail. Anything built
     * on this has to tolerate both — but both are a real dish under a
     * near-identical name, which is what the move bought.
     *
     * On a retried generation (see `MAX_GENERATION_ATTEMPTS`) it fires for the
     * attempt that CLEARS the gate, never for the ones that were dropped.
     */
    onDishReviewed?: (dish: GenerateSuggestionResponseDto) => void;
}

// `accumulateSuggestionReveals` lives in `suggestion-reveals.ts` so the
// streaming-conformance check can import it without loading this module's
// Supabase and LLM graph; it is used locally below and deliberately NOT
// re-exported, since importing it from here is what broke that check.
// The type is re-exported because `StreamSingleSuggestionOptions.onField`
// exposes it and callers need to name it.
export type { PartialSuggestionFields };

/** Map the raw JSONL field names onto the enriched/DTO field names. */
function mapFields(stable: Record<string, unknown>): PartialSuggestionFields {
    const fields: PartialSuggestionFields = {};
    if (typeof stable.name === "string") fields.name = stable.name;
    if (typeof stable.name_alt === "string") fields.nameEn = stable.name_alt;
    if (typeof stable.description === "string") {
        fields.description = stable.description;
    }
    if (
        stable.difficulty === "easy" ||
        stable.difficulty === "medium" ||
        stable.difficulty === "hard"
    ) {
        fields.difficulty = stable.difficulty;
    }
    // Guarded rather than coerced: this is the PARTIAL reveal path, and a value
    // still mid-token ("4" of "45") must not paint a pill that then changes
    // band. `extractStableJsonFields` only surfaces finished values, so a number
    // here is complete — anything that is not one is left for the final parse,
    // where the schema's coercion and bounds apply.
    if (typeof stable.total_time_minutes === "number") {
        fields.totalTimeMinutes = stable.total_time_minutes;
    }
    if (Array.isArray(stable.ingredients)) {
        fields.ingredients = stable.ingredients.filter(
            (item): item is string => typeof item === "string"
        );
    }
    if (Array.isArray(stable.tags)) {
        fields.tags = stable.tags.filter(
            (item): item is string => typeof item === "string"
        );
    }
    return fields;
}

/**
 * How many times one request may be generated before it is reported unsatisfiable.
 *
 * The gate this feeds is a judgement at the margin and it is NOISY there:
 * "Roasted Brussels Sprouts with Balsamic" clears it at 0.9 while "Roasted
 * Brussels Sprouts with Romesco Sauce" is dropped as `obscure`. So a single roll
 * that lands badly is not evidence that the request has no answer — and until
 * this loop existed, one roll was all a chat turn ever got. The batch generator
 * has had `MAX_PASSES`, a ledger and a saturation test since it was written;
 * this path, which is the one CHAT uses, had none of it.
 *
 * Two, not more. Each attempt is a full generation plus a review, and the second
 * one is asked with the first one's name excluded — if the model comes back with
 * another nameless plate after being told the last one was rejected, the honest
 * answer is that there is no established dish here, and saying so beats spending
 * a third call to say it later. `unsatisfied` is what carries that answer to the
 * reader.
 */
const MAX_GENERATION_ATTEMPTS = 2;

/**
 * The retry's exclusion line.
 *
 * Deliberately NOT `buildExistingDishesBlock`, whose wording is "Already in the
 * catalog" — these dishes are the opposite of that. They were refused for not
 * being dishes at all, and naming the reason is what stops the model handing
 * back the same SHAPE of answer under a different garnish.
 */
const buildRejectedBlock = (names: string[]): string =>
    names.length === 0
        ? ""
        : `Rejected on this request (not established dishes — do NOT suggest these, nor another plate composed the same way): ${names.join(", ")}`;

/** One generation: stream it, validate it, and try to persist it. */
async function generateOnce(
    request: GenerateSuggestionRequestDto,
    options: StreamSingleSuggestionOptions,
    rejected: string[]
): Promise<{ outcome: SuggestionOutcome; name?: string }> {
    const { provider, onField, onDishReviewed } = options;

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "suggestions.single",
        system: SYSTEM_PROMPT,
        user: [
            options.dish ? `Dish: ${options.dish}` : "",
            buildSuggestionsUserPrompt(request),
            buildRejectedBlock(rejected),
        ]
            .filter(Boolean)
            .join("\n"),
        provider,
    });

    // Hold back the very first frame until the name lands, so the card never
    // renders empty.
    const buffer = await accumulateSuggestionReveals(stream, (stable) => {
        const fields = mapFields(stable);
        if (onField && fields.name) onField(fields);
    });

    // Parse the completed object and validate it against the strict schema.
    // Slice to the outermost braces so stray prose or markdown fences the model
    // occasionally adds around the object don't break JSON.parse.
    const objStart = buffer.indexOf("{");
    const objEnd = buffer.lastIndexOf("}");
    if (objStart === -1 || objEnd <= objStart) {
        console.warn(
            "[StreamSingleSuggestion] No JSON object in output:",
            buffer.slice(0, 200)
        );
        return { outcome: { kind: "dropped", reason: "invalid" } };
    }
    const cleaned = buffer.slice(objStart, objEnd + 1);

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        console.warn(
            "[StreamSingleSuggestion] Failed to parse suggestion JSON:",
            cleaned.slice(0, 200)
        );
        return { outcome: { kind: "dropped", reason: "invalid" } };
    }

    const validated = GenerateSuggestionResponseSchema.safeParse(parsed);
    if (!validated.success) {
        console.warn(
            "[StreamSingleSuggestion] Suggestion failed validation:",
            validated.error.message
        );
        return { outcome: { kind: "dropped", reason: "invalid" } };
    }

    const outcome = await persistOrReuseSuggestion(validated.data, request, {
        // Announced from inside the pipeline, past the gate — see
        // `onDishReviewed`. Guarded so a throwing listener cannot take down a
        // generation that has already been paid for; this is a notification, and
        // a notification must not own the outcome.
        onReviewed: onDishReviewed
            ? (dish) => {
                  try {
                      onDishReviewed(dish);
                  } catch (error) {
                      console.warn(
                          "[StreamSingleSuggestion] onDishReviewed threw:",
                          error
                      );
                  }
              }
            : undefined,
    });

    return { outcome, name: validated.data.name };
}

/**
 * Generate a SINGLE recipe suggestion, streaming its fields out as the LLM
 * writes them: `onField` fires with the title first, then the description, and
 * so on. Once the object is complete it is validated and persisted (reusing a
 * near-duplicate if one exists).
 *
 * Unlike the batch generator this one answers a SPECIFIC question, so the
 * catalog is never used to steer generation away from dishes the user already
 * has — asking about a dish you own should get you that dish. Dedup instead
 * resolves it to the existing recipe (`existing_recipe`), which the caller
 * surfaces in place of the streamed card.
 *
 * **Reveal granularity is provider-dependent.** The conformance check
 * (`evals/model-migration/streaming-conformance.check.ts`) measured Anthropic
 * emitting larger deltas than OpenAI: 3 `onField` frames where OpenAI produces 6
 * for the same object. The reveal stays correct either way — monotonic, never
 * revised, in prompt order — but on Bedrock the card animates in fewer, bigger
 * jumps. That is a product call to make at cutover, not a bug to fix here.
 *
 * A dropped generation is RETRIED once when the drop was a notability verdict —
 * see {@link MAX_GENERATION_ATTEMPTS}. Callers see one outcome either way.
 */
export async function streamSingleSuggestion(
    request: GenerateSuggestionRequestDto,
    options: StreamSingleSuggestionOptions = {}
): Promise<SuggestionOutcome> {
    const rejected: string[] = [];
    let last: SuggestionOutcome = { kind: "dropped", reason: "invalid" };

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const { outcome, name } = await generateOnce(request, options, rejected);
        last = outcome;

        if (outcome.kind !== "dropped") return outcome;

        // Only a notability drop is worth another roll. `not_food` is a property
        // of the REQUEST — ask for a mojito again and you get a mojito — and
        // `duplicate` / `persist_failed` / `invalid` are not questions a second
        // generation answers either. This is the same distinction the batch
        // generator's `saturated` test makes, for the same reason.
        if (outcome.reason !== "unauthentic") break;

        if (name) rejected.push(name);

        if (attempt + 1 < MAX_GENERATION_ATTEMPTS) {
            console.log(
                `[StreamSingleSuggestion] Retrying — "${name}" was not an established dish`
            );
        }
    }

    return last;
}
