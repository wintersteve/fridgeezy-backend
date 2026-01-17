import { openai } from "@fridgeezy/openai";
import {
    GenerateRecipeRequestDto,
    GenerateRecipeRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import {
    createRecipeStream,
    fetchRecipeMetadata,
    formatUnitsForPrompt,
    formatTagsForPrompt,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

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

export const generateRecipe = createStreamHandler({
    requestSchema: GenerateRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
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
                { role: "user", content: buildUserPrompt(body) },
            ],
            stream: true,
        });

        return {
            type: "stream" as const,
            stream: createRecipeStream(stream, {
                schemas: [
                    HeaderSchema,
                    NutritionSchema,
                    IngredientSchema,
                    InstructionSchema,
                    TipSchema,
                ],
                initialState: body,
            }),
        };
    },

    onComplete: async ({ result }) => {
        // result is the last yielded item: { type: "complete", saved: true, recipe }
        if (result?.recipe) {
            const persistResult = await persistRecipe(result.recipe);

            if (persistResult.success) {
                console.log(
                    `Recipe persisted successfully with ID: ${persistResult.value}`
                );
            } else {
                console.error(
                    "Failed to persist recipe:",
                    persistResult.error.message
                );
                // Don't throw - stream already completed
            }
        } else {
            console.warn("No recipe data in completion result");
        }
    },
});
