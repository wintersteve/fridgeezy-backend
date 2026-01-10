import { openai } from "@fridgeezy/openai";
import {
    GenerateRecipeRequestDto,
    GenerateRecipeRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { createRecipeStreamHandler } from "../../services";

const SYSTEM_PROMPT = `Generate exactly an authentic, real-world recipe based on the provided ingredients

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

const buildUserPrompt = (
    request: GenerateRecipeRequestDto
) => `Generate a detailed recipe for: ${request.name}
Required ingredients to use: ${request.ingredients.join(", ")}
Servings: ${request.servings}`;

export const generateRecipe = createStreamHandler({
    requestSchema: GenerateRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: buildUserPrompt(body) },
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
});
