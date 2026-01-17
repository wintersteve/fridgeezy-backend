import { openai } from "@fridgeezy/openai";
import {
    EscalateDifficultyRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    GenerateRecipeResponseDto,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import {
    createRecipeStream,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

const buildSystemPrompt = (
    units: string,
    tags: string,
    currentDifficulty: string,
    targetDifficulty: string
) => `Transform the provided recipe from ${currentDifficulty} difficulty to ${targetDifficulty} difficulty.

## Transformation Rules

### Core Constraints (MUST PRESERVE)
- Keep ALL main/core ingredients (proteins, primary vegetables, base components)
- Maintain the same cuisine and dish identity
- Use ONLY unit abbreviations and tags from the approved lists below

### Difficulty Modifications

When INCREASING difficulty:
- Use more advanced cooking techniques (e.g., "sauté and deglaze" vs "fry")
- Add optional ingredients for depth (fresh herbs, specialty aromatics, garnishes)
- Include detailed technique explanations with precision (temperatures, timing)
- Increase step granularity

When DECREASING difficulty:
- Simplify cooking techniques (e.g., "mix" vs "emulsify")
- Remove optional/garnish ingredients while keeping core ingredients
- Combine steps where possible
- Use simpler language, reduce precision requirements

### Output Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic and achievable at the target difficulty level
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

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","description":"Brief description","prepTime":15,"cookTime":30}

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
    existingRecipe: GenerateRecipeResponseDto,
    targetDifficulty: string
) => {
    const ingredientsList = existingRecipe.ingredients
        .map((ing) => `${ing.quantity}${ing.unit} ${ing.name}`)
        .join("\n");

    const instructionsList = existingRecipe.instructions
        .map((inst, idx) => `${idx + 1}. ${inst.text}`)
        .join("\n");

    return `Transform this recipe to ${targetDifficulty} difficulty:

Recipe Name: ${existingRecipe.name}
Current Difficulty: ${existingRecipe.difficulty}
Servings: ${existingRecipe.servings}

Current Ingredients:
${ingredientsList}

Current Instructions:
${instructionsList}

${existingRecipe.tips?.length ? `Tips:\n${existingRecipe.tips.join("\n")}` : ""}

Tags: ${existingRecipe.tags.join(", ")}

IMPORTANT: Keep recipe name "${existingRecipe.name}" and all core ingredients. Only modify techniques, optional ingredients, and instruction complexity.`;
};

export const escalateDifficulty = createStreamHandler({
    requestSchema: EscalateDifficultyRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        // 1. Fetch existing recipe
        const existingRecipe = await fetchRecipe(body.recipeId);

        if (!existingRecipe) {
            throw new Error(`Recipe not found: ${body.recipeId}`);
        }

        // 2. Validate difficulty transition
        if (existingRecipe.difficulty === body.targetDifficulty) {
            throw new Error(
                `Recipe is already at ${body.targetDifficulty} difficulty`
            );
        }

        // 3. Fetch metadata
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 4. Call OpenAI
        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(
                        unitsPrompt,
                        tagsPrompt,
                        existingRecipe.difficulty,
                        body.targetDifficulty
                    ),
                },
                {
                    role: "user",
                    content: buildUserPrompt(
                        existingRecipe,
                        body.targetDifficulty
                    ),
                },
            ],
            stream: true,
        });

        // 5. Return stream (initialState sets the base recipe properties)
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
                initialState: {
                    name: existingRecipe.name,
                    difficulty: body.targetDifficulty, // TARGET difficulty
                    servings: existingRecipe.servings,
                    tags: existingRecipe.tags,
                    ingredients: [], // AI will populate
                },
            }),
        };
    },

    onComplete: async ({ result }) => {
        if (result?.recipe) {
            const persistResult = await persistRecipe(result.recipe);

            if (persistResult.success) {
                console.log(
                    `Escalated recipe persisted with ID: ${persistResult.value}`
                );
            } else {
                console.error(
                    "Failed to persist escalated recipe:",
                    persistResult.error.message
                );
            }
        }
    },
});
