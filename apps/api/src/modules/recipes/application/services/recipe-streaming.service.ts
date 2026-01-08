import { z } from "zod/v4";

import { GenerateRecipeRequestDto } from "@/src/server/modules/recipes";
import { processJsonlStream } from "@/src/server/shared/streaming";

import { RecipeAccumulator } from "../../domain/entities";

export interface RecipeStreamConfig {
    schemas: [z.ZodType, z.ZodType, z.ZodType, z.ZodType]; // Header, Ingredient, Instruction, Tip
    initialState: GenerateRecipeRequestDto;
}

/**
 * Process an OpenAI stream for recipe generation, handling accumulation and streaming.
 *
 * This helper encapsulates the complex pattern used by recipe.ts and escalate-difficulty.ts:
 * 1. Parse JSONL stream with 4 schema types (Header, Ingredient, Instruction, Tip)
 * 2. Accumulate data into RecipeAccumulator based on schema index
 * 3. Yield each parsed item for SSE streaming
 * 4. Return final accumulated recipe object
 * 5. Handle edge case: set tips to null if empty array
 *
 * @param openaiStream - OpenAI completion stream
 * @param config - Configuration with schemas and initial servings
 * @yields Each parsed item (for SSE streaming)
 * @returns Final accumulated recipe data
 */
export async function* createRecipeStreamHandler(
    openaiStream: AsyncIterable<any>,
    config: RecipeStreamConfig
): AsyncGenerator<any, RecipeAccumulator> {
    const recipe: RecipeAccumulator = {
        ...config.initialState,
        description: "",
        prepTime: 0,
        cookTime: 0,
        ingredients: [],
        instructions: [],
        tips: [],
    };

    yield {
        type: "initial",
        ...config.initialState,
    };

    for await (const { parsed, schemaIndex } of processJsonlStream(
        openaiStream,
        config.schemas
    )) {
        // Schema 0: Header
        if (schemaIndex === 0) {
            recipe.description = parsed.description;
            recipe.prepTime = parsed.prepTime;
            recipe.cookTime = parsed.cookTime;
        }
        // Schema 1: Ingredient
        else if (schemaIndex === 1) {
            recipe.ingredients.push({
                name: parsed.name,
                category: parsed.category,
                parent: parsed.parent,
                quantity: parsed.quantity,
                unit: parsed.unit,
            });
        }
        // Schema 2: Instruction
        else if (schemaIndex === 2) {
            recipe.instructions.push({
                text: parsed.text,
                ingredients: parsed.ingredients,
            });
        }
        // Schema 3: Tip
        else if (schemaIndex === 3) {
            recipe.tips?.push(parsed.text);
        }

        // Yield for SSE streaming
        yield parsed;
    }

    // Finalize: set tips to null if empty (database expects null, not empty array)
    if (recipe.tips?.length === 0) {
        recipe.tips = null;
    }

    // Send completion event
    yield { type: "complete", saved: true };

    // Return accumulated data for persistence
    return recipe;
}
