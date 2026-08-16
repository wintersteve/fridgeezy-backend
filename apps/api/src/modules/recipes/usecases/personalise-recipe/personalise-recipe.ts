import { generateStream } from "@fridgeezy/llm";
import {
    GenerateRecipeResponseDto,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    PersonaliseRecipeRequestSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { RecipesRepository } from "@fridgeezy/supabase";
import { Request } from "express";

import {
    buildModifySystemPrompt,
    buildModifyUserPrompt,
    callerMayReadRecipe,
    createRecipeStream,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
    readStandingPreferences,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

/**
 * The label this variant is saved under, matching the offer the client made.
 *
 * Fixed rather than derived from the preferences, unlike `modify`'s. The
 * version selector lists a cook's own versions of a dish, and "Spicier, plainer
 * technique, no coriander" is not a name — "Your usual" is what they tapped and
 * what they will look for.
 */
const VARIANT_LABEL = "Your usual";

/**
 * `POST /rest/recipes/:recipeId/personalise` — rewrite this dish the way this
 * cook keeps asking for, as a variant.
 *
 * ## Why this is not done during generation
 *
 * Because `promote` and `generate-recipe` persist with `created_by NULL`, into
 * the **shared catalogue**. Folding standing preferences into those prompts —
 * which an earlier version of this feature did — writes one cook's palate into
 * the dish everyone else is served by `findByCanonicalName`, and with one
 * catalogue slot per (canonical_id, difficulty) the first person to promote a
 * dish would define it for all of them. It is also precisely the drift the
 * authenticity gate exists to stop, arriving through a door that gate does not
 * watch.
 *
 * So the catalogue keeps the attested recipe and this writes a variant beside
 * it. That is the shape `decideReuse` already uses for a blacklist, and the
 * economics come with it: the adaptation is paid for **once per cook per dish
 * family**, and every visit afterwards is served from `recipe_family_defaults`
 * for free. Nobody pays for a version they did not ask for, because nothing
 * here runs until they tap.
 *
 * ## It does not record what it does
 *
 * `modify` writes a taste signal from its instruction. If this ran through that
 * path, applying your preferences would reinforce them on every use — a loop
 * that ratchets one way. This endpoint exists partly so that loop is closed
 * structurally rather than by a flag someone can forget.
 */
export const personaliseRecipe = createStreamHandler({
    requestSchema: PersonaliseRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body, req }) => {
        const recipeId = (req as Request).params.recipeId;

        if (!recipeId) {
            return {
                type: "raw" as const,
                statusCode: 400,
                data: { error: "recipeId is required" },
            };
        }

        const existingRecipe = await fetchRecipe(recipeId);

        // Refusal folded into the not-found branch, as everywhere else that
        // reads a recipe by id through the service-role client: "you may not
        // read it" and "it is not there" must be indistinguishable.
        if (
            !existingRecipe ||
            !(await callerMayReadRecipe(existingRecipe.createdBy, req))
        ) {
            return {
                type: "raw" as const,
                statusCode: 404,
                data: { error: `Recipe not found: ${recipeId}` },
            };
        }

        const preferences = await readStandingPreferences(req);

        // Nothing asked for twice yet. A 409 rather than an empty stream: the
        // client should not have offered this, and an empty 200 would leave it
        // rendering a generation that never produces a recipe.
        if (!preferences) {
            return {
                type: "raw" as const,
                statusCode: 409,
                data: {
                    error: "No standing preferences to apply",
                    code: "no_preferences",
                },
            };
        }

        const repository = new RecipesRepository();
        const base = await repository.resolveVariantBase(recipeId);

        if (!base.success) {
            console.error(
                "Failed to resolve the personalised recipe's base:",
                base.error.message
            );

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Could not resolve the recipe family" },
            };
        }

        const baseRecipeId = base.value;

        // Same dish, so the source recipe's hero still depicts it — and the
        // image model is the most expensive thing in the pipeline.
        const existingImageUrl = (existingRecipe as { imageUrl?: string })
            .imageUrl;

        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "recipe.personalise",
            system: buildModifySystemPrompt(unitsPrompt, tagsPrompt),
            user: buildModifyUserPrompt(
                existingRecipe,
                `Adjust this recipe to how the cook usually asks for it: ${preferences.instruction}. These are standing preferences, not a brief — apply each only where the dish genuinely allows it, and leave the dish recognisably itself.`,
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
                difficulty: existingRecipe.difficulty, // a variant, not a rung
                servings: existingRecipe.servings,
                tags: existingRecipe.tags, // MUST remain constant
            },
        });

        async function* streamWithPersist(): AsyncGenerator<unknown> {
            let finalRecipe: GenerateRecipeResponseDto | undefined;

            for await (const frame of recipeStream) {
                if (
                    frame &&
                    typeof frame === "object" &&
                    (frame as { type?: string }).type === "complete"
                ) {
                    finalRecipe = (
                        frame as { recipe: GenerateRecipeResponseDto }
                    ).recipe;
                    // Held back; re-emitted below with the persisted id, which
                    // is the key the client's done-detector reads.
                    continue;
                }

                yield frame;
            }

            if (!finalRecipe) {
                yield { type: "complete", saved: false };
                return;
            }

            // Lineage in the INSERT, never patched on afterwards: a row that is
            // briefly unparented is, to `recipes_canonical_id_difficulty_unique`,
            // a second base recipe under the base's name, and the insert is what
            // fails.
            const persistResult = await persistRecipe(
                finalRecipe,
                existingImageUrl,
                baseRecipeId
            );

            if (!persistResult.success) {
                console.error(
                    "Failed to persist the personalised recipe:",
                    persistResult.error.message
                );
                yield { type: "complete", saved: false };
                return;
            }

            yield {
                type: "complete",
                saved: true,
                id: persistResult.value,
                label: VARIANT_LABEL,
                image: existingImageUrl,
                recipe: { ...finalRecipe, id: persistResult.value },
            };
        }

        return {
            type: "stream" as const,
            stream: streamWithPersist(),
        };
    },
});
