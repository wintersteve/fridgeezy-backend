import { openai } from "@fridgeezy/openai";
import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { SuggestionsRepository } from "@fridgeezy/supabase";
import { castArray } from "@fridgeezy/toolkit";
import type OpenAI from "openai";

import { fetchEnrichedSuggestion } from "./fetch-enriched-suggestion";
import { persistSuggestion } from "./persist-suggestion";

const SYSTEM_PROMPT = `You are a recipe suggestion assistant. Generate exactly 5 authentic, real-world recipe suggestions based on the provided ingredients.

## Rules
- AUTHENTICITY IS PARAMOUNT: Only suggest real, well-documented recipes that exist in culinary traditions.
- Each recipe MUST be a genuine dish with its authentic name (e.g., Murgh Makhani, NOT "Indian Tomato Butter Chicken"). Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- If a combination is not authentic (e.g., rosemary in Thai cuisine), do NOT invent dishes. Generate an empty array instead! VERY IMPORTANT!
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
Output EXACTLY 5 recipes, one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

Each recipe object must include:
- name
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

    const suggestionsRepo = new SuggestionsRepository();

    // Process JSONL stream with validation
    for await (const { parsed } of processJsonlStream(stream, [
        GenerateSuggestionResponseSchema,
    ])) {
        console.log(parsed);
        const suggestion = parsed as GenerateSuggestionResponseDto;

        // Check if a similar suggestion already exists (similarity threshold: 0.95)
        const searchResult = await suggestionsRepo.searchSimilar(
            suggestion.name,
            0.95,
            1
        );

        if (!searchResult.success) {
            console.error(
                `[Suggestions] Failed to search similar suggestions for "${suggestion.name}":`,
                searchResult.error
            );
            // Continue with persistence if search fails
        } else if (searchResult.value.length > 0) {
            // Similar suggestion exists, fetch enriched data and yield it
            const existingSuggestion = searchResult.value[0];
            console.log(
                `[Suggestions] Found similar suggestion: ${existingSuggestion.name} (score: ${existingSuggestion.score.toFixed(3)}) - reusing instead of creating duplicate`
            );

            const enrichedResult = await fetchEnrichedSuggestion(
                existingSuggestion.id
            );

            if (enrichedResult.success) {
                yield enrichedResult.value;
                continue;
            } else {
                console.error(
                    `[Suggestions] Failed to fetch enriched suggestion ${existingSuggestion.id}:`,
                    enrichedResult.error
                );
                // Fall through to create new suggestion
            }
        }

        // No similar suggestion found or fetch failed, persist new suggestion
        const persistResult = await persistSuggestion(suggestion, {
            cuisineTag: request.cuisine,
        });

        if (!persistResult.success) {
            console.error(
                `[Suggestions] Failed to persist: ${suggestion.name}`,
                persistResult.error
            );
            // Skip this suggestion if persistence fails
            continue;
        }

        // Yield to client with enriched ingredient and tag data (id + name)
        yield {
            id: persistResult.value.suggestionId,
            name: suggestion.name,
            description: suggestion.description,
            difficulty: suggestion.difficulty,
            ingredients: persistResult.value.ingredients,
            tags: persistResult.value.tags,
        };
    }
}
