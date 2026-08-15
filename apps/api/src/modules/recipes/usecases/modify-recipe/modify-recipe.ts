import { generateStream } from "@fridgeezy/llm";
import {
    ModifyRecipeRequestSchema,
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
    buildModifySystemPrompt,
    buildModifyUserPrompt,
    createRecipeStream,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

/**
 * Derive a short, human-readable label for the variant from the raw
 * instruction, e.g. "make it vegetarian" -> "Vegetarian". Best-effort only —
 * the user can rename it when saving.
 */
const deriveLabel = (instruction: string): string => {
    const cleaned = instruction
        .trim()
        .replace(/^(please\s+)?(can you\s+)?(make (it|this)|turn (it|this) into|convert (it|this) to)\s+/i, "")
        .trim();
    const label = cleaned.length > 0 ? cleaned : instruction.trim();
    const capped = label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label;
    return capped.charAt(0).toUpperCase() + capped.slice(1);
};

export const modifyRecipe = createStreamHandler({
    requestSchema: ModifyRecipeRequestSchema,
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

        // Reuse the source recipe's image — a variation of the same dish looks
        // the same, so we skip the slow/costly image generation.
        const existingImageUrl = (existingRecipe as { imageUrl?: string })
            .imageUrl;

        const label = deriveLabel(body.instruction);

        // 2. Fetch metadata for the prompt
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 3. Call the model
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "recipe.modify",
            system: buildModifySystemPrompt(unitsPrompt, tagsPrompt),
            user: buildModifyUserPrompt(
                existingRecipe,
                body.instruction,
                body.dietaryRestrictions
            ),
        });

        const recipeStream = createRecipeStream(stream, {
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
                difficulty: existingRecipe.difficulty, // unchanged for a modification
                servings: existingRecipe.servings,
                tags: existingRecipe.tags, // MUST remain constant
            },
        });

        // 4. Wrap the recipe stream so we can persist the finished variant and
        //    return its new id. The client's done-detector fires on the
        //    `complete` frame, so we must fold the persisted id + label INTO that
        //    terminal frame — the recipe stream's own `complete` carries an empty
        //    id (it's persisted out-of-band), so we hold it back and re-emit a
        //    `complete` once the row exists. (The generic handler's onComplete
        //    hook runs only after the connection closes, so it can't do this.)
        async function* streamWithPersist() {
            let finalRecipe: GenerateRecipeResponseDto | undefined;

            for await (const frame of recipeStream) {
                if (
                    frame &&
                    typeof frame === "object" &&
                    (frame as { type?: string }).type === "complete"
                ) {
                    finalRecipe = (frame as { recipe: GenerateRecipeResponseDto })
                        .recipe;
                    // Suppress the id-less completion; re-emitted below with the id.
                    continue;
                }
                yield frame;
            }

            if (!finalRecipe) {
                yield { type: "complete", saved: false };
                return;
            }

            // Tag the lineage in the INSERT itself. The variant keeps the base's
            // name, so an untagged row shows up in search as an indistinguishable
            // duplicate — that has to be true from the moment it exists, not from
            // when the user saves it, and not one statement later either: the
            // partial unique index treats a momentarily-unparented variant as a
            // duplicate base recipe and rejects the insert.
            const base = await new RecipesRepository().resolveVariantBase(
                body.id
            );

            if (!base.success) {
                console.error(
                    "Failed to resolve the modified recipe's base:",
                    base.error.message
                );
            }

            const persistResult = await persistRecipe(
                finalRecipe,
                existingImageUrl,
                base.success ? base.value : null
            );

            if (persistResult.success) {
                yield {
                    type: "complete",
                    saved: true,
                    id: persistResult.value,
                    label,
                    recipe: finalRecipe,
                };
            } else {
                console.error(
                    "Failed to persist modified recipe:",
                    persistResult.error.message
                );
                // Still emit a terminal frame so the client stops streaming.
                yield { type: "complete", saved: false };
            }
        }

        return {
            type: "stream" as const,
            stream: streamWithPersist(),
        };
    },
});
