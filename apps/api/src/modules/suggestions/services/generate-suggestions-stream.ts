import { openai } from "@fridgeezy/openai";
import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { castArray } from "@fridgeezy/toolkit";
import type OpenAI from "openai";

import { persistOrReuseSuggestion } from "./persist-or-reuse-suggestion";

const SYSTEM_PROMPT = `You are a recipe suggestion assistant. Generate exactly 4 authentic, real-world recipe suggestions based on the user's request.

The "Ingredients" line below may list literal ingredients, but it may ALSO be a dish name (e.g. "sandwich", "carbonara"), a meal or course concept (e.g. "breakfast", "quick dinner", "random recipe"), or a cuisine. Interpret it flexibly:
- Literal ingredients -> real dishes that prominently feature them.
- A dish name -> authentic variations of that dish (classic and regional versions).
- A meal/course or cuisine concept -> a varied set of authentic dishes that fit it.

## Rules
- AUTHENTICITY IS PARAMOUNT: Only suggest real, well-documented recipes that exist in culinary traditions.
- Each recipe MUST be a genuine dish with its authentic name (e.g., Murgh Makhani, NOT "Indian Tomato Butter Chicken"). Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- Only return an empty array when the request genuinely cannot be satisfied authentically — a truly incompatible INGREDIENT combination (e.g., rosemary in Thai cuisine) or nonsensical input. A real dish name, cuisine, or meal/course concept is ALWAYS satisfiable, so NEVER return an empty array for those.
- Do NOT include recipes where a blacklisted item is normally present.

## Difficulty Levels
- "easy": The standard, most authentic version of the dish with all traditional techniques and essential ingredients.
- "medium": An elevated but authentic version with refined techniques or premium ingredient variations.
- "hard": A sophisticated, chef-level authentic interpretation featuring advanced techniques or upscale variations.

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe:
  - Use the specific component type if it matches (e.g., roux for a roux, sauce for bechamel, stock for a stock)
  - Use "dish" for regular finished dishes/meals
- EXACTLY 1 cuisine tag per recipe (the most accurate cuisine origin)
- EXACTLY 1 course tag per recipe (the most accurate course type)
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Ingredients
- MUST be singular

## Output Format
Output EXACTLY 4 recipes, one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

Each recipe object must include:
- name
- name_en (the English name of the dish, e.g. "Butter Chicken" for "Murgh Makhani")
- description (max 50 characters)
- difficulty (easy, medium, or hard)
- ingredients (array of strings)
- tags (array of strings with component, cuisine, and dietary tags)`;

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

export async function* generateSuggestionsStream(
    request: GenerateSuggestionRequestDto,
    client: OpenAI = openai
): AsyncGenerator<EnrichedSuggestionResponseDto> {
    const stream = await client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(request) },
        ],
        stream: true,
    });

    // Process JSONL stream with validation
    for await (const { parsed } of processJsonlStream(stream, [
        GenerateSuggestionResponseSchema,
    ])) {
        const suggestion = parsed as GenerateSuggestionResponseDto;

        const enriched = await persistOrReuseSuggestion(suggestion, request);
        if (enriched) yield enriched;
    }
}
