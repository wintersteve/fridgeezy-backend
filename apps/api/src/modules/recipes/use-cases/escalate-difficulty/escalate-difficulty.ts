import {
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@/src/server/modules/recipes/domain/schemas";
import { DifficultyValue } from "@/src/server/modules/recipes/domain/value-objects";
import { createStreamHandler } from "@/src/server/shared/streaming";
import { fetchTagsCached } from "@/src/server/shared/tags";
import { fetchUnitsCached } from "@/src/server/shared/units";
import { openai } from "@/src/shared/openai";

import {
    createRecipeStreamHandler,
    EscalateDifficultyRequestSchema,
    persistGenerateRecipe,
} from "../../application";
import { RecipeIngredientsRepo, RecipesRepo } from "../../infastracture";

export const escalateDifficulty = createStreamHandler({
    requestSchema: EscalateDifficultyRequestSchema,
    responseSchema: [
        HeaderSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        // Fetch the existing recipe from database
        const { data: existingRecipe, error: recipeError } =
            await RecipesRepo.getById(body.recipeId);

        if (recipeError || !existingRecipe) {
            return {
                type: "raw" as const,
                statusCode: 404,
                data: { error: "Recipe not found" },
            };
        }

        // Fetch recipe ingredients with full details
        const { data: recipeIngredients, error: ingredientsError } =
            await RecipeIngredientsRepo.getByRecipeId(body.recipeId);

        if (ingredientsError) {
            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to fetch recipe ingredients" },
            };
        }

        // Fetch valid tags and units from database (cached for 5 minutes)
        const [tags, units] = await Promise.all([
            fetchTagsCached(),
            fetchUnitsCached(),
        ]);

        const unitsByType = units.reduce(
            (acc, u) => {
                if (!acc[u.type]) acc[u.type] = [];
                acc[u.type].push({
                    id: u.id,
                    abbr: u.abbreviation,
                    name: u.name,
                });
                return acc;
            },
            {} as Record<string, { id: string; abbr: string; name: string }[]>
        );

        const unitsListForPrompt = Object.entries(unitsByType)
            .map(
                ([type, items]) =>
                    `${type}:\n${items.map((u) => `  - ${u.name} (${u.abbr}): "${u.id}"`).join("\n")}`
            )
            .join("\n");

        // Calculate new difficulty
        const currentDifficulty = existingRecipe.difficulty || "easy";
        const newDifficulty = DifficultyValue.escalate(currentDifficulty);

        // Format existing ingredients for the prompt
        const ingredientsList = recipeIngredients
            ?.map((ri: any) => {
                const ingredient = ri.ingredients;
                const unit = ri.units;
                const category = ingredient.categories?.name || "unknown";
                return `${ri.quantity} ${unit.abbreviation} ${ingredient.name} (category: ${category})`;
            })
            .join("\n");

        const systemPrompt = `You are a culinary expert specializing in recipe enhancement. You are given an existing recipe and must elevate it to a higher difficulty level by:

1. **Refining cooking techniques**: Replace basic methods with more sophisticated, professional techniques
2. **Adding ingredients**: Introduce high-quality, specialty ingredients that elevate the dish
3. **Enhancing presentation**: Include plating and presentation techniques
4. **Increasing complexity**: Add steps that require more skill and precision

## Available Values
Tags (dietary): ${tags.dietary.join(", ")}
Tags (cuisine): ${tags.cuisine.join(", ")}

Units (use UUID):
${unitsListForPrompt}

## Rules
- The recipe name should remain similar but can be refined (e.g., "Chicken Pasta" -> "Pan-Seared Chicken with Handmade Pasta")
- Current difficulty: ${currentDifficulty} → New difficulty: ${newDifficulty}
- Keep the core dish concept but elevate everything
- Add 2-5 specialty ingredients that complement and enhance the original ingredients
- Use more refined techniques (e.g., "boil pasta" → "prepare fresh pasta using pasta machine")
- Use only tags and unit UUIDs from the lists above
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step

## Ingredient Hierarchy
Each ingredient must include:
- name: The specific ingredient (lowercase_underscore_singular)
- category: The top-level food category (meat, poultry, seafood, dairy, vegetable, fruit, grain, legume, herb, spice, oil, condiment, nut, seed, sweetener, beverage, other)
- parent: The immediate parent ingredient if applicable (null if none)

Examples:
- leg_of_lamb -> parent: "lamb", category: "meat"
- lamb -> parent: null, category: "meat"
- chicken_breast -> parent: "chicken", category: "poultry"
- red_bell_pepper -> parent: "bell_pepper", category: "vegetable"
- extra_virgin_olive_oil -> parent: "olive_oil", category: "oil"
- ground_cumin -> parent: "cumin", category: "spice"

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","name":"Recipe Name","description":"Brief description","difficulty":"${newDifficulty}","servings":4,"prepTime":15,"cookTime":30,"tags":["tag1"]}

Lines 2-N - One line per ingredient:
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"unit-uuid"}

Lines N+1-M - One line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

Optional tip lines:
{"type":"tip","text":"Cooking tip"}

No markdown, no code blocks, just JSONL.`;

        const userPrompt = `Elevate this recipe to a higher difficulty level:

**Original Recipe: ${existingRecipe.name}**
Description: ${existingRecipe.description || "No description"}
Current Difficulty: ${currentDifficulty}
Servings: ${existingRecipe.servings}
Prep Time: ${existingRecipe.prepTime || 0} minutes
Cook Time: ${existingRecipe.cookTime || 0} minutes

**Current Ingredients:**
${ingredientsList}

**Current Instructions:**
${existingRecipe.instructions?.map((instruction: string, idx: number) => `${idx + 1}. ${instruction}`).join("\n")}

${existingRecipe.tips?.length ? `**Current Tips:**\n${existingRecipe.tips.join("\n")}` : ""}

Please elevate this recipe with more refined techniques and additional high-quality ingredients.`;

        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            stream: true,
        });

        return {
            type: "stream" as const,
            stream: createRecipeStreamHandler(stream, {
                schemas: [
                    HeaderSchema,
                    IngredientSchema,
                    InstructionSchema,
                    TipSchema,
                ],
                initialState: body as any,
            }),
        };
    },

    onComplete: async ({ result }) => {
        // Persist the escalated recipe to database
        await persistGenerateRecipe(result);
    },
});
