import { openai } from "@fridgeezy/openai";
import {
    PromoteSuggestionRequestSchema,
    HeaderSchema,
    NutritionSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { SuggestionsRepository } from "@fridgeezy/supabase";
import { Request } from "express";

import {
    createRecipeStream,
    RecipeStreamInitialState,
    fetchRecipeMetadata,
    formatUnitsForPrompt,
    formatTagsForPrompt,
} from "../../../recipes/services";
import { generateAndUploadRecipeImage } from "../../../recipes/services/create-recipe-image";
import { persistRecipeWithIngredientIds } from "../../../recipes/services/persist-recipe";
import { fetchEnrichedSuggestion } from "../../services";

/**
 * Build system prompt with explicit ingredient constraints.
 * The LLM MUST use ONLY the provided ingredients.
 */
const buildSystemPrompt = (
    units: string,
    tags: string,
    ingredientNames: string[]
) => `Generate exactly an authentic, real-world recipe based on the provided ingredients

## CRITICAL: Ingredient Constraints
You MUST use ONLY these ingredients (no additions, no substitutions):
${ingredientNames.map((name) => `- ${name}`).join("\n")}

When outputting ingredients, use the EXACT names from the list above.
Every instruction step should reference only ingredients from this list.
You MUST provide quantity and unit for EACH ingredient above.

## Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic
- ALWAYS use unit abbreviations from the approved list below (never invent new units)
- ALWAYS use tag names from the approved list below (never invent new tags)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

## Valid Tags
Use ONLY these tags when tagging recipes. Tags must accurately represent the recipe:

${tags}

## Tagging Rules
- EXACTLY 1 component tag per recipe (use "dish" for regular finished dishes/meals)
- EXACTLY 1 cuisine tag per recipe (the most accurate cuisine origin)
- At least 1 course tag (appetizer, starter, main, side, or dessert)
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques while keeping ingredients authentic.
- "medium": The standard authentic recipe with its usual techniques.
- "hard": Elevated or advanced version of the dish, which may include optional ingredients or more complex techniques.

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","name":"Recipe Name","description":"Brief description","difficulty":"easy","servings":4,"prepTime":15,"cookTime":30,"tags":["tag1","tag2"]}

Line 2 - Nutrition information (per serving):
{"type":"nutrition","kcal":450,"carbs":35,"protein":25,"fat":15}

Lines 3-N - One line per ingredient (use approved unit abbreviations only):
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"g","comment":"peeled and diced"}

Note: The "comment" field is optional but should be included when the ingredient requires preparation (e.g., "peeled", "deveined", "crushed", "finely chopped", "at room temperature"). Omit if no special preparation is needed.

Lines N+1-M - One line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

Optional tip lines:
{"type":"tip","text":"Cooking tip"}

No markdown, no code blocks, just JSONL.`;

/**
 * Build user prompt using suggestion data.
 */
const buildUserPrompt = (
    name: string,
    difficulty: string,
    ingredientNames: string[],
    servings: number
) => `Generate a detailed ${difficulty} level recipe for: ${name}
Use ONLY these ingredients: ${ingredientNames.join(", ")}
Servings: ${servings}`;

export const promoteSuggestion = createStreamHandler({
    requestSchema: PromoteSuggestionRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body, req }) => {
        // Cast to Express Request to access params
        const expressReq = req as unknown as Request;
        const { id } = expressReq.params;

        if (!id) {
            throw new Error("Suggestion ID is required");
        }

        // 1. Fetch enriched suggestion with ingredients and tags
        const suggestionResult = await fetchEnrichedSuggestion(id);

        if (!suggestionResult.success) {
            const error = suggestionResult.error;

            if (error.name === "NotFoundError") {
                return {
                    type: "raw" as const,
                    statusCode: 404,
                    data: { error: `Suggestion with ID ${id} not found` },
                };
            }

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: error.message },
            };
        }

        const suggestion = suggestionResult.value;

        // 2. Create ingredient ID map (lowercase name -> UUID)
        const ingredientIdMap = new Map<string, string>();
        for (const ing of suggestion.ingredients) {
            ingredientIdMap.set(ing.name.toLowerCase(), ing.id);
        }

        // 3. Extract ingredient names for prompt
        const ingredientNames = suggestion.ingredients.map((i) => i.name);
        const tagNames = suggestion.tags.map((t) => t.name);

        // 4. Fetch metadata from Supabase
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 5. Build initial state for stream
        const initialState: RecipeStreamInitialState = {
            name: suggestion.name,
            nameEn: suggestion.nameEn,
            difficulty: suggestion.difficulty,
            servings: body.servings,
            tags: tagNames,
        };

        // Kick off image generation now (name is known), so it runs in parallel
        // with the entire recipe generation instead of waiting for the header.
        // Fire-and-forget: persistence reads the deterministic URL either way.
        generateAndUploadRecipeImage(suggestion.name).catch((error) => {
            console.error("Image generation failed:", error);
        });

        // 6. Call OpenAI
        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(unitsPrompt, tagsPrompt, ingredientNames),
                },
                {
                    role: "user",
                    content: buildUserPrompt(
                        suggestion.name,
                        suggestion.difficulty,
                        ingredientNames,
                        body.servings
                    ),
                },
            ],
            stream: true,
        });

        // 7. Create recipe stream with ingredient ID map
        const recipeStream = createRecipeStream(stream, {
            schemas: [
                HeaderSchema,
                NutritionSchema,
                IngredientSchema,
                InstructionSchema,
                TipSchema,
            ],
            initialState,
            ingredientIdMap,
        });

        // 8. Wrap stream to persist recipe and delete suggestion
        async function* wrappedStream(): AsyncGenerator<any> {
            let lastResult: any;

            for await (const chunk of recipeStream) {
                lastResult = chunk;

                // Yield all chunks except the final completion
                if (chunk.type !== "complete") {
                    yield chunk;
                }
            }

            // After stream completes, persist the recipe and yield final message with ID
            if (lastResult?.type === "complete" && lastResult.recipe) {
                // Persist using ingredient IDs directly (no canonical_id lookup needed)
                const persistResult = await persistRecipeWithIngredientIds(lastResult.recipe);

                if (persistResult.success) {
                    console.log(
                        `Recipe persisted successfully with ID: ${persistResult.value}`
                    );

                    // Delete the suggestion after successful recipe creation
                    const suggestionsRepo = new SuggestionsRepository();
                    const deleteResult = await suggestionsRepo.delete(id);

                    if (deleteResult.success) {
                        console.log(
                            `Suggestion ${id} removed after promotion to recipe`
                        );
                    } else {
                        console.error(
                            "Failed to delete suggestion:",
                            deleteResult.error.message
                        );
                    }

                    // Yield final completion with recipe ID
                    yield {
                        ...lastResult,
                        id: persistResult.value,
                    };
                } else {
                    console.error(
                        "Failed to persist recipe:",
                        persistResult.error.message
                    );
                    // Yield completion without ID if persistence failed
                    yield lastResult;
                }
            } else if (lastResult) {
                // Yield the last result if it wasn't a complete type
                yield lastResult;
            }
        }

        return {
            type: "stream" as const,
            stream: wrappedStream(),
        };
    },
});
