import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import {
    ADAPTED_FOR_RULE,
    BLACKLIST_RULE,
    FOOD_ONLY_RULE,
} from "./constraint-rules";
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
- AUTHENTICITY IS PARAMOUNT: Only suggest a real, well-documented recipe that exists in a culinary tradition.
- The recipe MUST be a genuine, documented dish — never an invented or descriptive name (e.g., NOT "Indian Tomato Butter Chicken"). Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- ${COMPONENT_FILTER_RULE}
- ${DISH_FORM_FILTER_RULE}
- ${FOOD_ONLY_RULE}
- If the request cannot be satisfied authentically under these constraints, pick the closest authentic dish that does satisfy them. The one exception is a request for a DRINK: there, return nothing rather than reaching for the closest food.

## Constraints
${BLACKLIST_RULE}

## Difficulty Levels
- "easy": The standard, most authentic version of the dish with all traditional techniques and essential ingredients.
- "medium": An elevated but authentic version with refined techniques or premium ingredient variations.
- "hard": A sophisticated, chef-level authentic interpretation featuring advanced techniques or upscale variations.

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
 */
export async function streamSingleSuggestion(
    request: GenerateSuggestionRequestDto,
    options: StreamSingleSuggestionOptions = {}
): Promise<SuggestionOutcome> {
    const { provider, onField } = options;

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "suggestions.single",
        system: SYSTEM_PROMPT,
        user: buildSuggestionsUserPrompt(request),
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
        return { kind: "dropped", reason: "invalid" };
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
        return { kind: "dropped", reason: "invalid" };
    }

    const validated = GenerateSuggestionResponseSchema.safeParse(parsed);
    if (!validated.success) {
        console.warn(
            "[StreamSingleSuggestion] Suggestion failed validation:",
            validated.error.message
        );
        return { kind: "dropped", reason: "invalid" };
    }

    return persistOrReuseSuggestion(validated.data, request);
}
