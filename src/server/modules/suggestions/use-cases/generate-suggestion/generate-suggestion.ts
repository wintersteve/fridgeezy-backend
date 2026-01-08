import { RecipesRepo } from "@/src/server/modules/recipes";
import { SuggestionsMapper } from "@/src/server/modules/suggestions/application/mappers/suggestions-mapper/suggestions-mapper";
import { SuggestionsRepo } from "@/src/server/modules/suggestions/infastracture";
import {
    createStreamHandler,
    processJsonlStream,
} from "@/src/server/shared/streaming";
import { openai } from "@/src/shared/openai";
import { castArray } from "@/src/shared/toolkit";

import {
    GenerateSuggestionRequestSchema,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "../../application";

export const generateSuggestion = createStreamHandler({
    requestSchema: GenerateSuggestionRequestSchema,
    responseSchema: GenerateSuggestionResponseSchema,

    handler: async ({ body }) => {
        const systemPrompt = `You are a recipe suggestion assistant. Generate exactly 5 authentic, real-world recipe suggestions based on the provided ingredients.
## Rules
- Suggest 5 authentic, well-known recipes that use the provided ingredients.
- Each recipe MUST be a real dish (not invented, must be authentic) with their real name.
- If a combination is not authentic (e.g., rosemary in Thai cuisine), do NOT invent dishes. Generate an empty array instead! VERY IMPORTANT!
- Do NOT include recipes where a blacklisted item is normally present.
- The name must be the authentic name (e.g., Murgh Makhani, NOT Indian Tomato Butter Chicken). Do NOT add alternative names in parenthesis.

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques while keeping ingredients authentic.
- "medium": The standard authentic recipe with its usual techniques.
- "hard": Elevated or advanced version of the dish, which may include optional ingredients or more complex techniques.

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe:
  - Use the specific component type if it matches (e.g., roux for a roux, sauce for bechamel, stock for a stock)
  - Use "dish" for regular finished dishes/meals
- EXACTLY 1 cuisine tag per recipe (the most accurate cuisine origin)
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Output Format
Output EXACTLY 5 recipes, one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.  

Each recipe object must include:
- name
- description (max 50 characters)
- difficulty (easy, medium, or hard)
- ingredients (array of strings)
- tags (array of strings with component, cuisine, and dietary tags)
`;

        const format = (filter: string, value?: string | string[]) => {
            const isValid = Array.isArray(value) ? value.length > 0 : !!value;

            return isValid ? `${filter}: ${castArray(value).join(",")}` : "";
        };

        const userPrompt = [
            format("Blacklist", body.blacklist),
            format("Component", body.component),
            format("Course", body.course),
            format("Cuisine", body.cuisine),
            format("Difficulty", body.difficulty),
            format("Dietary Restrictions", body.dietaryRestrictions),
            format("Ingredients", body.ingredients),
        ].join("\n");

        const stream = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            stream: true,
        });

        // Use processJsonlStream to handle buffering and validation
        async function* suggestionStream() {
            for await (const { parsed } of processJsonlStream(stream, [
                GenerateSuggestionResponseSchema,
            ])) {
                yield parsed;
            }
        }

        return {
            type: "stream" as const,
            stream: suggestionStream(),
        };
    },
    // onComplete: async ({
    //     result,
    // }: {
    //     result: GenerateSuggestionResponseDto;
    // }) => {
    //     const suggestion = SuggestionsMapper.fromLLM(result);
    //
    //     const suggestionResponse = await SuggestionsRepo.getByName(
    //         suggestion.name
    //     );
    //
    //     const recipeResponse = await RecipesRepo.getByName(suggestion.name);
    //
    //     if (suggestionResponse.data?.id || recipeResponse.data?.id) return;
    //
    //     await SuggestionsRepo.insert(result);
    // },
});
