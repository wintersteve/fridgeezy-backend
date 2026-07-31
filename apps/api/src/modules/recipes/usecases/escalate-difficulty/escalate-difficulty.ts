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
import { RecipesRepository } from "@fridgeezy/supabase";

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
- Keep the recipe NAME exactly as provided (never change it)
- Keep ALL recipe TAGS exactly as provided (dietary restrictions like shellfish-free, vegan, gluten-free must remain unchanged)
- Keep ALL main/core ingredients (proteins, primary vegetables, base components)
- Maintain the same cuisine and dish identity
- Use ONLY unit abbreviations and tags from the approved lists below

### What Should Change Based on Difficulty

When INCREASING difficulty:
- **Cooking Techniques**: Use more advanced techniques (e.g., "sauté and deglaze" vs "fry")
- **Ingredients**: Add optional ingredients for depth (fresh herbs, specialty aromatics, garnishes)
- **Instructions**: Include detailed technique explanations with precision (temperatures, timing), increase step granularity
- **Time**: Increase prepTime and cookTime to reflect more complex preparation and techniques
- **Nutrition**: Adjust nutritional values (kcal, carbs, protein, fat) based on added ingredients and cooking methods

When DECREASING difficulty:
- **Cooking Techniques**: Simplify techniques (e.g., "mix" vs "emulsify")
- **Ingredients**: Remove optional/garnish ingredients while keeping core ingredients
- **Instructions**: Combine steps where possible, use simpler language, reduce precision requirements
- **Time**: Decrease prepTime and cookTime to reflect simpler preparation
- **Nutrition**: Adjust nutritional values (kcal, carbs, protein, fat) based on removed ingredients and simpler methods

### Output Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic and achievable at the target difficulty level
- Times (prepTime, cookTime) MUST be realistic for the target difficulty level
- Nutritional values MUST accurately reflect the adjusted ingredient list
- ALWAYS use unit abbreviations from the approved list below (never invent new units)
- ALWAYS use tag names from the approved list below (never invent new tags)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

## Valid Tags
Use ONLY these tags when tagging recipes. Tags must accurately represent the recipe:

${tags}

## Tagging Rules
- Use EXACTLY the same tags as the original recipe (do not add, remove, or modify any tags)
- Tags include component, cuisine, course, and dietary restriction tags
- Dietary tags (shellfish-free, vegan, gluten-free, etc.) MUST remain unchanged regardless of difficulty

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info (adjust prepTime and cookTime for target difficulty):
{"type":"header","description":"Brief description","shortDescription":"One-line card description","prepTime":15,"cookTime":30}
The two description fields are different lengths and both are required:
- "description": 2-3 sentences for the recipe detail screen.
- "shortDescription": ONE short sentence (max 60 characters) for recipe cards, which show a single line. Must read as a complete phrase, never a truncation of "description".


Line 2 - Nutrition information (per serving, adjust based on ingredient changes):
{"type":"nutrition","kcal":450,"carbs":35,"protein":25,"fat":15}

Line 3-N - Optional tip lines (MAXIMUM 3 — output the 3 most useful and stop;
extra tips are discarded). Write these HERE, straight after the nutrition line
and before the first ingredient — never at the end:
{"type":"tip","text":"Cooking tip"}

Then one line per ingredient (use approved unit abbreviations only):
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"g"}

Then one line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

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

    const nutritionInfo = `Calories: ${existingRecipe.kcal}kcal, Carbs: ${existingRecipe.carbs}g, Protein: ${existingRecipe.protein}g, Fat: ${existingRecipe.fat}g`;

    return `Transform this recipe to ${targetDifficulty} difficulty:

Recipe Name: ${existingRecipe.name}
Description: ${existingRecipe.description}
Current Difficulty: ${existingRecipe.difficulty}
Servings: ${existingRecipe.servings}
Prep Time: ${existingRecipe.prepTime} min
Cook Time: ${existingRecipe.cookTime} min

Current Nutrition (per serving):
${nutritionInfo}

Current Ingredients:
${ingredientsList}

Current Instructions:
${instructionsList}

${existingRecipe.tips?.length ? `Tips:\n${existingRecipe.tips.map((t) => t.text).join("\n")}` : ""}

Tags: ${existingRecipe.tags.join(", ")}

IMPORTANT CONSTRAINTS:
- Keep recipe name "${existingRecipe.name}" EXACTLY as is
- Use EXACTLY this description in the header: "${existingRecipe.description}"
- Use EXACTLY these tags: ${existingRecipe.tags.join(", ")} (do not add, remove, or modify any tags)
- Keep all core ingredients (proteins, primary vegetables, base components)
- Adjust prepTime and cookTime to be realistic for ${targetDifficulty} difficulty
- Adjust nutritional values based on any ingredient changes
- Modify techniques, optional ingredients, and instruction complexity to match ${targetDifficulty} difficulty`;
};

// Store existing image URL + source recipe for reuse in onComplete
let existingImageUrl: string | undefined;
let sourceRecipeId: string | undefined;

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
        const existingRecipe = await fetchRecipe(body.id);

        if (!existingRecipe) {
            throw new Error(`Recipe not found: ${body.id}`);
        }

        // Store the existing image URL to reuse it (avoid regenerating)
        existingImageUrl = (existingRecipe as any).imageUrl;
        sourceRecipeId = body.id;

        // 2. Validate difficulty transition
        if (existingRecipe.difficulty === body.difficulty) {
            throw new Error(
                `Recipe is already at ${body.difficulty} difficulty`
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
                        body.difficulty
                    ),
                },
                {
                    role: "user",
                    content: buildUserPrompt(existingRecipe, body.difficulty),
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
                    name: existingRecipe.name, // MUST remain constant
                    nameEn: existingRecipe.nameEn,
                    difficulty: body.difficulty, // TARGET difficulty
                    servings: existingRecipe.servings,
                    tags: existingRecipe.tags, // MUST remain constant
                },
                // No image generation here — escalate reuses the existing
                // recipe's image (passed to persistRecipe as existingImageUrl).
            }),
        };
    },

    onComplete: async ({ result }) => {
        if (result?.recipe) {
            // Reuse existing image URL instead of generating a new one
            const persistResult = await persistRecipe(result.recipe, existingImageUrl);

            if (persistResult.success) {
                console.log(
                    `Escalated recipe persisted with ID: ${persistResult.value}`
                );

                // Same reasoning as modify-recipe: an escalated recipe keeps the
                // base's name (the prompt forbids changing it), so an untagged
                // row shows up in discovery as a second, indistinguishable
                // "Apfelstrudel". Tag the lineage so search filters it out.
                if (sourceRecipeId) {
                    const variantResult = await new RecipesRepository().markAsVariant(
                        persistResult.value,
                        sourceRecipeId
                    );

                    if (!variantResult.success) {
                        console.error(
                            "Failed to mark escalated recipe as a variant:",
                            variantResult.error.message
                        );
                    }
                }
            } else {
                console.error(
                    "Failed to persist escalated recipe:",
                    persistResult.error.message
                );
            }
        }
    },
});
