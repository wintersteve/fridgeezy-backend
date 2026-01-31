import { openai } from "@fridgeezy/openai";
import {
    GenerateRecipeRequestDto,
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
    fetchRecipeMetadata,
    formatUnitsForPrompt,
    formatTagsForPrompt,
} from "../../../recipes/services";
import { persistRecipe } from "../../../recipes/services/persist-recipe";
import { fetchEnrichedSuggestion, matchIngredients } from "../../services";

const buildSystemPrompt = (
    units: string,
    tags: string
) => `Generate exactly an authentic, real-world recipe based on the provided ingredients

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
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"g"}
{"type":"ingredient","name":"ingredient_name","category":"vegetables","parent":null,"quantity":100,"unit":"g","comment":"finely chopped"}

Lines N+1-M - One line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

Optional tip lines:
{"type":"tip","text":"Cooking tip"}

No markdown, no code blocks, just JSONL.`;

const buildUserPrompt = (
    request: GenerateRecipeRequestDto
) => `Generate a detailed recipe for: ${request.name}
Required ingredients to use: ${request.ingredients.join(", ")}
Servings: ${request.servings}`;

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

        // Fetch the enriched suggestion by ID
        const suggestionResult = await fetchEnrichedSuggestion(id);

        if (!suggestionResult.success) {
            const error = suggestionResult.error;

            // Handle NotFoundError with 404
            if (error.name === "NotFoundError") {
                return {
                    type: "raw" as const,
                    statusCode: 404,
                    data: { error: `Suggestion with ID ${id} not found` },
                };
            }

            // Handle other persistence errors
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: error.message },
            };
        }

        const suggestion = suggestionResult.value;

        // Transform enriched data: extract names from {id, name} objects
        const ingredients = suggestion.ingredients.map((i) => i.name);
        const tags = suggestion.tags.map((t) => t.name);

        // Build the recipe request with transformed data
        const recipeRequest: GenerateRecipeRequestDto = {
            name: suggestion.name,
            difficulty: suggestion.difficulty,
            ingredients: ingredients,
            tags: tags,
            servings: body.servings,
            id: id, // Include the suggestion ID so it gets deleted after recipe creation
        };

        // Fetch metadata from Supabase
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(unitsPrompt, tagsPrompt),
                },
                { role: "user", content: buildUserPrompt(recipeRequest) },
            ],
            stream: true,
        });

        const recipeStream = createRecipeStream(stream, {
            schemas: [
                HeaderSchema,
                NutritionSchema,
                IngredientSchema,
                InstructionSchema,
                TipSchema,
            ],
            initialState: recipeRequest,
        });

        // Wrap the stream to persist the recipe and include the ID in the final message
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
                // Ensure all LLM ingredients exist in database before persisting
                // Suggestion ingredients already exist, but LLM might add new ones
                const toCanonicalId = (name: string): string =>
                    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

                console.log(`[Promote] Suggestion has ${suggestion.ingredients.length} ingredients:`,
                    suggestion.ingredients.map(i => i.name));

                // Create set of suggestion ingredient canonical IDs
                const suggestionIngredientIds = new Set(
                    suggestion.ingredients.map(ing => toCanonicalId(ing.name))
                );
                console.log(`[Promote] Suggestion canonical IDs:`, Array.from(suggestionIngredientIds));

                // Find ingredients from LLM that aren't in the suggestion
                console.log(`[Promote] LLM generated ${lastResult.recipe.ingredients.length} ingredients:`,
                    lastResult.recipe.ingredients.map((i: any) => `${i.name} (${toCanonicalId(i.name)})`));

                const newIngredients = lastResult.recipe.ingredients
                    .map((ing: any) => ing.name)
                    .filter((name: string) => !suggestionIngredientIds.has(toCanonicalId(name)));

                // Match/create any new ingredients not in the suggestion
                if (newIngredients.length > 0) {
                    console.log(`[Promote] Matching ${newIngredients.length} new ingredients not in suggestion:`, newIngredients);
                    const matchResult = await matchIngredients(newIngredients);

                    if (!matchResult.success) {
                        console.error("[Promote] Failed to match ingredients:", matchResult.error.message);
                        yield {
                            type: "error",
                            error: `Failed to match ingredients: ${matchResult.error.message}`,
                        };
                        return;
                    }

                    console.log(`[Promote] Successfully matched ${matchResult.value.length} ingredients`);
                }

                // Now all ingredients should exist - persist the recipe
                console.log(`[Promote] Persisting recipe with ${lastResult.recipe.ingredients.length} ingredients:`,
                    lastResult.recipe.ingredients.map((i: any) => i.name));
                const persistResult = await persistRecipe(lastResult.recipe);

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
