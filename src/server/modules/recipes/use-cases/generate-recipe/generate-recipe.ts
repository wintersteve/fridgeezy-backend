import {
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@/src/server/modules/recipes/domain/schemas";
import { createStreamHandler } from "@/src/server/shared/streaming";
import { openai } from "@/src/shared/openai";

import {
    createRecipeStreamHandler,
    GenerateRecipeRequestSchema,
} from "../../application";

export const generateRecipe = createStreamHandler({
    requestSchema: GenerateRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        // Fetch valid tags and units from database (cached for 5 minutes)
        // const [units] = await Promise.all([fetchUnitsCached()]);
        //
        // const unitsByType = units.reduce(
        //     (acc, u) => {
        //         if (!acc[u.type]) acc[u.type] = [];
        //         acc[u.type].push({
        //             id: u.id,
        //             abbr: u.abbreviation,
        //             name: u.name,
        //         });
        //         return acc;
        //     },
        //     {} as Record<string, { id: string; abbr: string; name: string }[]>
        // );

        // const unitsListForPrompt = Object.entries(unitsByType)
        //     .map(
        //         ([type, items]) =>
        //             `${type}:\n${items.map((u) => `  - ${u.name} (${u.abbr}): "${u.id}"`).join("\n")}`
        //     )
        //     .join("\n");

        const systemPrompt = `Generate exactly an authentic, real-world recipe based on the provided ingredients

## Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques while keeping ingredients authentic.
- "medium": The standard authentic recipe with its usual techniques.
- "hard": Elevated or advanced version of the dish, which may include optional ingredients or more complex techniques.

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

        const userPrompt = `Generate a detailed recipe for: ${body.name}
Required ingredients to use: ${body.ingredients.join(", ")}
Servings: ${body.servings}`;

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
                initialState: body,
            }),
        };
    },

    onComplete: async () => {
        // Persist the accumulated recipe to database
        // await persistGenerateRecipe(result);
    },
});
