import {
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@/src/server/modules/recipes/domain/schemas";
import { createMcpHandler } from "@/src/server/shared/streaming";
import { fetchTagsCached } from "@/src/server/shared/tags";
import { fetchUnitsCached } from "@/src/server/shared/units";
import { openai } from "@/src/shared/openai";

import {
    createRecipeStreamHandler,
    GenerateRecipeRequestSchema,
    persistGenerateRecipe,
} from "../../application";

export const generateRecipe = createMcpHandler({
    requestSchema: GenerateRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
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

        const systemPrompt = `You are a recipe generation assistant.

## Available Values
Tags (dietary): ${tags.dietary.join(", ")}
Tags (cuisine): ${tags.cuisine.join(", ")}

Units (use UUID):
${unitsListForPrompt}

## Rules
- Recipe name MUST be exactly: "${body.title}"
- Use ALL provided ingredients (may add common pantry items)
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
{"type":"header","name":"Recipe Name","description":"Brief description","difficulty":"easy","servings":4,"prepTime":15,"cookTime":30,"tags":["tag1"]}

Lines 2-N - One line per ingredient:
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"unit-uuid"}

Lines N+1-M - One line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

Optional tip lines:
{"type":"tip","text":"Cooking tip"}

No markdown, no code blocks, just JSONL.`;

        const userPrompt = `Generate a detailed recipe for: ${body.title}

Required ingredients to use: ${body.ingredients.join(", ")}
Servings: ${body.servings}${body.dietaryRestrictions?.length ? `\nDietary restrictions: ${body.dietaryRestrictions.join(", ")}` : ""}`;

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
                initialServings: body.servings,
            }),
        };
    },

    onComplete: async ({ result }) => {
        // Persist the accumulated recipe to database
        await persistGenerateRecipe(result);
    },
});
