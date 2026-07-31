import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { Stream } from "openai/core/streaming.mjs";
import { ChatCompletionChunk } from "openai/resources/index.mjs";
import { z } from "zod/v4";

/**
 * The recipe screen shows tips in a small carousel, so the prompts ask for at
 * most this many. Enforced here as well — the instruction alone isn't something
 * the UI can rely on.
 */
const MAX_TIPS = 3;

/**
 * Initial state passed to the recipe stream, containing data from the suggestion.
 */
export interface RecipeStreamInitialState {
    name: string;
    nameEn?: string | null;
    difficulty: "easy" | "medium" | "hard";
    servings: number;
    tags: string[];
}

export interface RecipeStreamConfig {
    schemas: [z.ZodType, z.ZodType, z.ZodType, z.ZodType, z.ZodType]; // Header, Nutrition, Ingredient, Instruction, Tip
    initialState: RecipeStreamInitialState;
    /**
     * Map of lowercase ingredient names to their database UUIDs.
     * Used to attach ingredient IDs during streaming when generating from a suggestion.
     */
    ingredientIdMap?: Map<string, string>;
}

export async function* createRecipeStream(
    openaiStream: Stream<ChatCompletionChunk>,
    config: RecipeStreamConfig
): AsyncGenerator<any, GenerateRecipeResponseDto> {
    const recipe: GenerateRecipeResponseDto = {
        id: "",
        name: config.initialState.name,
        nameEn: config.initialState.nameEn ?? null,
        difficulty: config.initialState.difficulty,
        servings: config.initialState.servings,
        tags: config.initialState.tags,
        description: "",
        shortDescription: null,
        prepTime: 0,
        cookTime: 0,
        kcal: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
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
            recipe.shortDescription = parsed.shortDescription ?? null;
            recipe.prepTime = parsed.prepTime;
            recipe.cookTime = parsed.cookTime;
            // NB: image generation is kicked off by the usecase BEFORE this
            // stream starts (the name is known up front), so it runs in parallel
            // with the whole recipe generation rather than starting here.
        }
        // Schema 1: Nutrition
        else if (schemaIndex === 1) {
            recipe.kcal = parsed.kcal;
            recipe.carbs = parsed.carbs;
            recipe.protein = parsed.protein;
            recipe.fat = parsed.fat;
        }
        // Schema 2: Ingredient
        else if (schemaIndex === 2) {
            const ingredient: any = {
                name: parsed.name,
                category: parsed.category,
                parent: parsed.parent,
                quantity: parsed.quantity,
                unit: parsed.unit,
                // Optional prep note (e.g. "finely chopped"); only present when
                // the LLM deems it useful. Carried through so it streams to the
                // client and is persisted alongside the ingredient.
                ...(parsed.comment ? { comment: parsed.comment } : {}),
            };

            // Attach ingredient ID from map if available
            if (config.ingredientIdMap) {
                const ingredientId = config.ingredientIdMap.get(
                    parsed.name.toLowerCase()
                );
                if (ingredientId) {
                    ingredient.ingredientId = ingredientId;
                } else {
                    console.warn(
                        `[RecipeStream] LLM generated ingredient "${parsed.name}" not in suggestion ingredient map`
                    );
                }
            }

            recipe.ingredients.push(ingredient);
        }
        // Schema 3: Instruction
        else if (schemaIndex === 3) {
            const instruction: any = {
                text: parsed.text,
                ingredients: parsed.ingredients,
            };

            // Map ingredient names to IDs if map available
            if (config.ingredientIdMap && parsed.ingredients) {
                const ingredientIds: string[] = [];
                for (const ingredientName of parsed.ingredients) {
                    const ingredientId = config.ingredientIdMap.get(
                        ingredientName.toLowerCase()
                    );
                    if (ingredientId) {
                        ingredientIds.push(ingredientId);
                    }
                }
                if (ingredientIds.length > 0) {
                    instruction.ingredientIds = ingredientIds;
                }
            }

            recipe.instructions.push(instruction);
        }
        // Schema 4: Tip
        else if (schemaIndex === 4) {
            // Drop anything past the cap without yielding it, so the client
            // never renders a tip the saved recipe won't have.
            if ((recipe.tips?.length ?? 0) >= MAX_TIPS) {
                continue;
            }

            recipe.tips?.push({ text: parsed.text });
        }

        // Yield for SSE streaming
        yield parsed;
    }

    // Finalize: set tips to null if empty (database expects null, not empty array)
    if (recipe.tips?.length === 0) {
        recipe.tips = null;
    }

    // Log warning if nutrition values are all zeros (indicates parsing failure)
    if (
        recipe.kcal === 0 &&
        recipe.carbs === 0 &&
        recipe.protein === 0 &&
        recipe.fat === 0
    ) {
        console.warn(
            `[RecipeStream] Nutrition values are all zeros for recipe "${recipe.name}" - LLM may have failed to generate nutrition data`
        );
    }

    // Send completion event with recipe data
    // The onComplete hook receives the last yielded item
    yield { type: "complete", saved: true, recipe };

    // Return accumulated data for persistence
    return recipe;
}
