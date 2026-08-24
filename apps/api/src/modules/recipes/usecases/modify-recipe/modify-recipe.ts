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

import { recordPrompt } from "../../../prompts/services";
import {
    buildModifySystemPrompt,
    callerMayReadRecipe,
    buildModifyUserPrompt,
    createRecipeStream,
    deriveVariantLabel,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
    recordTasteSignal,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

export const modifyRecipe = createStreamHandler({
    route: "recipes.modify",
    requestSchema: ModifyRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body, req }) => {
        // 1. Fetch existing recipe
        const existingRecipe = await fetchRecipe(body.id);

        // An owned recipe (an import) is readable only by its owner, and the
        // service-role client this fetch goes through sees past the RLS that
        // enforces that everywhere else — so the check lives here. Folded into
        // the not-found branch on purpose: "you may not read it" and "it is not
        // there" must be indistinguishable, or the error message becomes a way
        // to test whether a given id exists.
        if (
            !existingRecipe ||
            !(await callerMayReadRecipe(existingRecipe.createdBy, req))
        ) {
            throw new Error(`Recipe not found: ${body.id}`);
        }

        // Reuse the source recipe's image — a variation of the same dish looks
        // the same, so we skip the slow/costly image generation.
        const existingImageUrl = (existingRecipe as { imageUrl?: string })
            .imageUrl;

        const label = deriveVariantLabel(body.instruction);

        // What the cook asks for here is the strongest taste signal the app
        // gets: they read a recipe and said what was wrong with it. Recorded
        // from the LABEL rather than the raw instruction so that repeated asks
        // land on one row and can cross the threshold — see
        // `derive-variant-label.ts`. Fire-and-forget; it cannot fail this
        // request.
        recordTasteSignal(req, "modification", label);

        // The same input, kept the other way round. `recordTasteSignal` stores
        // the canonicalised LABEL so repeats collapse onto one countable row;
        // this stores the sentence AS TYPED, which is the thing canonicalisation
        // throws away and the only thing a history list can show. Neither is
        // derivable from the other, so both writes happen from here. Also
        // fire-and-forget.
        recordPrompt(req, "recipe_modify", body.instruction, { recipeId: body.id });

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
