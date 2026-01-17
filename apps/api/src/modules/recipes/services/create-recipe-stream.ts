import {
    GenerateRecipeRequestDto,
    GenerateRecipeResponseDto,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { Stream } from "openai/core/streaming.mjs";
import { ChatCompletionChunk } from "openai/resources/index.mjs";
import { z } from "zod/v4";

import { generateAndUploadRecipeImage } from "./create-recipe-image";

export interface RecipeStreamConfig {
    schemas: [z.ZodType, z.ZodType, z.ZodType, z.ZodType]; // Header, Ingredient, Instruction, Tip
    initialState: GenerateRecipeRequestDto;
}

export async function* createRecipeStream(
    openaiStream: Stream<ChatCompletionChunk>,
    config: RecipeStreamConfig
): AsyncGenerator<any, GenerateRecipeResponseDto> {
    const recipe: GenerateRecipeResponseDto = {
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

            // Generate and upload recipe image in parallel (don't await)
            generateAndUploadRecipeImage(config.initialState.name).catch(
                (error) => {
                    console.error("Image generation failed:", error);
                }
            );
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

    // Send completion event with recipe data
    // The onComplete hook receives the last yielded item
    yield { type: "complete", saved: true, recipe };

    // Return accumulated data for persistence
    return recipe;
}
