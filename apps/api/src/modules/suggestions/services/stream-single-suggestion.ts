import { openai } from "@fridgeezy/openai";
import {
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { castArray } from "@fridgeezy/toolkit";
import type OpenAI from "openai";

import { extractStableJsonFields } from "./extract-stable-json-fields";
import {
    persistOrReuseSuggestion,
    SuggestionOutcome,
} from "./persist-or-reuse-suggestion";

/**
 * The visible-first key order the model must emit so the card reveals fields in
 * a natural order: title, then description, then difficulty, then the chips.
 * `name_alt` trails since it's only needed for persistence, not the card.
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
- DIETARY RESTRICTIONS (if provided) are mandatory: the dish MUST genuinely satisfy every one of them.
- BLACKLIST (if provided): never suggest a recipe where a blacklisted item is normally present.
- If the request cannot be satisfied authentically under these constraints, pick the closest authentic dish that does satisfy them.

## Difficulty Levels
- "easy": The standard, most authentic version of the dish with all traditional techniques and essential ingredients.
- "medium": An elevated but authentic version with refined techniques or premium ingredient variations.
- "hard": A sophisticated, chef-level authentic interpretation featuring advanced techniques or upscale variations.

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag: use the specific component type if it matches (e.g., roux, sauce, stock), otherwise "dish" for a regular finished dish/meal.
- EXACTLY 1 cuisine tag (the most accurate cuisine origin).
- EXACTLY 1 course tag (the most accurate course type).
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies).

## Ingredients
- MUST be singular.

## Output Format
Output EXACTLY ONE JSON object. No markdown, no code blocks, no extra text.
Emit the keys in EXACTLY this order:
- name (the name an English-speaking home cook would most commonly recognise the dish by — keep the NATIVE name when that is what people actually say in English: Pho, Ramen, Paella, Kimchi, Gyoza, Coq au Vin, Pad Thai, Tiramisu, Risotto; use the ENGLISH name when that is the common one: "Butter Chicken" not "Murgh Makhani", "Apple Strudel" not "Apfelstrudel". Judge the whole name, not the parts: "Kimchi" stays Kimchi, but "Kimchi Jjigae" is usually met as "Kimchi Stew")
- description (ONE complete phrase, max 60 characters — it is shown on a single-line card, so it must not read as a cut-off sentence)
- difficulty (easy, medium, or hard)
- ingredients (array of strings)
- tags (array of strings with component, cuisine, and dietary tags)
- name_alt (the OTHER name: the native spelling if \`name\` is English, the English translation if \`name\` is native. Use null when the dish is only ever known by one name — do NOT echo \`name\`, and do NOT invent a translation nobody uses)`;

const buildUserPrompt = (request: GenerateSuggestionRequestDto): string => {
    const formatFilter = (filter: string, value?: string | string[]) => {
        const isValid = Array.isArray(value) ? value.length > 0 : !!value;
        return isValid ? `${filter}: ${castArray(value).join(",")}` : "";
    };

    return [
        formatFilter("Blacklist", request.blacklist),
        formatFilter("Component", request.component),
        formatFilter("Course", request.course),
        formatFilter("Cuisine", request.cuisine),
        formatFilter("Difficulty", request.difficulty),
        formatFilter("Dietary Restrictions", request.dietaryRestrictions),
        formatFilter("Ingredients", request.ingredients),
    ]
        .filter(Boolean)
        .join("\n");
};

/**
 * The subset of a suggestion's raw fields that have streamed in so far. Fields
 * are cumulative — each `onField` call carries every field known up to that
 * point — so a consumer can render the latest state directly.
 */
export interface PartialSuggestionFields {
    name?: string;
    nameEn?: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard";
    ingredients?: string[];
    tags?: string[];
}

export interface StreamSingleSuggestionOptions {
    client?: OpenAI;
    /**
     * Called each time a new top-level field finishes streaming, with every
     * field known so far. Lets a caller reveal the card field-by-field.
     */
    onField?: (fields: PartialSuggestionFields) => void;
}

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
 */
export async function streamSingleSuggestion(
    request: GenerateSuggestionRequestDto,
    options: StreamSingleSuggestionOptions = {}
): Promise<SuggestionOutcome> {
    const { client = openai, onField } = options;

    const stream = await client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(request) },
        ],
        stream: true,
    });

    let buffer = "";
    // Which top-level keys we've already surfaced, so we only emit on new ones.
    let emittedKeys = 0;

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (!content) continue;

        buffer += content;

        const stable = extractStableJsonFields(buffer);
        const keyCount = Object.keys(stable).length;

        // A new field finished — surface everything known so far. Hold back the
        // very first frame until the name lands so the card never renders empty.
        if (keyCount > emittedKeys) {
            emittedKeys = keyCount;
            const fields = mapFields(stable);
            if (onField && fields.name) onField(fields);
        }
    }

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
