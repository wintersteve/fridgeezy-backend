import {
    GenerateRecipeResponseDto,
    HeaderSchema,
    ImportRecipeRequestSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { ingredientCanonicalId, splitIngredientName } from "@fridgeezy/toolkit";
import type { Request } from "express";

import { trackBackgroundTask } from "../../../../background-tasks";
// Imported from the file rather than the `services` barrel, the way
// `extract-ingredients` does: that barrel also pulls in the suggestion
// generation stack, and this needs one function from it.
import { matchIngredients } from "../../../suggestions/services/match-ingredients";
import {
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../../services";
import {
    generateAndUploadRecipeImage,
    getRecipeImagePublicUrl,
} from "../../services/create-recipe-image";
import { persistImportedRecipe } from "../../services/persist-recipe";
import type { ImportedRecipeRead } from "../../services/read-recipe-from-image";
import { readRecipeFromImage } from "../../services/read-recipe-from-image";
import { resolveProfileId } from "../../services/resolve-profile-id";

/**
 * Turn the model's read into the recipe DTO persistence wants, attaching the
 * catalog ingredient id each line resolved to.
 *
 * Parenthetical qualifiers are lifted out of ingredient names into the comment
 * by `splitIngredientName`, for the same two reasons `createRecipeStream` does
 * it: the name is what the id map is keyed on, and a name carrying "(boneless)"
 * matches nothing. The prompt asks for this shape directly — this is the belt to
 * that braces, and a page that prints "flour (plus extra for dusting)" is
 * exactly the input that needs it.
 */
function toRecipeDto(
    read: ImportedRecipeRead,
    ingredientIdByName: Map<string, string>
): GenerateRecipeResponseDto {
    const ingredients = read.ingredients.map((ingredient) => {
        const { name, note } = splitIngredientName(
            ingredient.name,
            ingredient.comment ?? undefined
        );

        return {
            name,
            category: ingredient.category,
            parent: null,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            ...(note ? { comment: note } : {}),
            ingredientId: ingredientIdByName.get(ingredientCanonicalId(name)),
        };
    });

    const instructions = read.instructions.map((instruction) => {
        const referenced = (instruction.ingredients ?? []).map(
            (referencedName) => splitIngredientName(referencedName).name
        );

        const ingredientIds = referenced
            .map((referencedName) =>
                ingredientIdByName.get(ingredientCanonicalId(referencedName))
            )
            .filter((id): id is string => Boolean(id));

        return {
            text: instruction.text,
            ...(instruction.title ? { title: instruction.title } : {}),
            ingredients: referenced,
            ...(ingredientIds.length > 0 ? { ingredientIds } : {}),
            ...(instruction.duration_seconds
                ? { durationSeconds: instruction.duration_seconds }
                : {}),
            ...(typeof instruction.temperature_c === "number"
                ? { temperatureC: instruction.temperature_c }
                : {}),
            ...(instruction.equipment?.length
                ? { equipment: instruction.equipment }
                : {}),
        };
    });

    return {
        id: "",
        name: read.name,
        nameEn: read.name_en ?? null,
        description: read.description,
        shortDescription: read.short_description ?? null,
        difficulty: read.difficulty,
        servings: read.servings,
        prepTime: read.prep_time_minutes,
        cookTime: read.cook_time_minutes,
        kcal: read.kcal,
        carbs: read.carbs,
        protein: read.protein,
        fat: read.fat,
        tags: read.tags,
        ingredients,
        instructions,
        // NULL rather than [] when empty: the database expects null, and the
        // recipe stream normalises the same way.
        tips: read.tips.length > 0 ? read.tips.map((text) => ({ text })) : null,
    } as GenerateRecipeResponseDto;
}

/**
 * `POST /rest/recipes/import` — read a recipe off a photograph and save it as
 * the caller's own.
 *
 * ## SSE, and why the read still happens before the stream opens
 *
 * Every other write in this module answers with SSE, the client assembles
 * recipes frame-by-frame through one hook, and the saved row's id arrives on the
 * terminal `complete` frame. Answering with plain JSON here would make import
 * the one recipe endpoint the recipe screen cannot consume, so it does not.
 *
 * But the frames are replayed from a read that is already finished, not piped
 * live from the model, and that ordering is the point rather than a shortcut:
 *
 * - **A photograph can fail in ways a prompt cannot.** "This is a picture of a
 *   cat" and "this page is out of focus" are the two most likely outcomes of the
 *   whole feature, and both need to reach the user as something they can act on.
 *   Once `createStreamHandler` opens the stream it has committed to a 200, and a
 *   failure can only be a frame — which every client then has to know to branch
 *   on before it looks anything up. Deciding first buys a real 422 with a code.
 * - **Reading is not incremental anyway.** The model must see the whole page
 *   before it knows whether there is a recipe on it, so there is no partial
 *   result being withheld here. What the user waits for is one vision call.
 *
 * The consequence to know: the frames arrive together, in a burst, rather than
 * trickling. Nothing in the contract changes — and if the read is ever switched
 * to a streaming JSONL prompt, this endpoint can start emitting live without the
 * client noticing.
 *
 * ## Not gated by `requireEntitlement`
 *
 * Import is an account-tier feature, like generate, modify and escalate. It is
 * one vision call and no image spend beyond what any dish costs, and it produces
 * content the user brought in themselves rather than content this app wrote for
 * them — the weakest possible case for a paywall. Making it premium is a product
 * decision and a one-line change (`recipes.routes.ts`), not a default to drift
 * into.
 */
export const importRecipe = createStreamHandler({
    requestSchema: ImportRecipeRequestSchema,
    // An array, so the factory streams. Deliberately the SAME five schemas
    // `generate` and `modify` declare: the frames on the wire are the frames the
    // recipe screen already parses, and an import that spoke its own dialect
    // would need a second assembler on the client for the same recipe.
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],
    // Base64 image payloads, same as `ingredients/extract`.
    useBufferedParser: true,

    handler: async ({ body, req }) => {
        // 1. Who is importing. Resolved FIRST, before a paid vision call: an
        //    import with no owner cannot be stored (`recipes_imported_has_owner`
        //    rejects it), so discovering this afterwards would mean billing the
        //    user for a read that had nowhere to go.
        //
        //    This is also the one route in the app that `ALLOW_UNAUTHENTICATED`
        //    cannot make work — with the gate off there is no subject at all, and
        //    the alternative to failing here is writing somebody's private recipe
        //    into the shared catalogue. Local testing needs a real token.
        const profileId = await resolveProfileId(
            (req as Request).supabaseUserId
        );

        if (!profileId) {
            return {
                type: "raw" as const,
                statusCode: 401,
                data: {
                    error: "Recipe import requires a signed-in user with a profile",
                    code: "no_profile",
                },
            };
        }

        // Re-bound after the guard because the stream below is a hoisted
        // function declaration, and TypeScript will not carry a narrowing into
        // one — it cannot prove the call happens after the check.
        const owner: string = profileId;

        // 2. The vocabularies the read has to land inside. Same metadata the
        //    generators prompt with, so a unit or tag that persists from a
        //    generated recipe persists from an imported one.
        const metadata = await fetchRecipeMetadata();

        const read = await readRecipeFromImage({
            image: body.image,
            imageType: body.imageType,
            mimeType: body.mimeType,
            units: formatUnitsForPrompt(metadata.units),
            tags: formatTagsForPrompt(metadata.tags),
        });

        if (read.outcome === "rejected") {
            return {
                type: "raw" as const,
                statusCode: 422,
                data: {
                    error:
                        read.code === "not_a_recipe"
                            ? "No recipe found on this image"
                            : "This image could not be read clearly enough",
                    code: read.code,
                    ...(read.detail ? { detail: read.detail } : {}),
                },
            };
        }

        if (read.outcome === "failed") {
            return {
                type: "raw" as const,
                statusCode: read.statusCode,
                data: { error: read.message, code: "read_failed" },
            };
        }

        const recipeRead = read.recipe;

        // 3. Resolve the read ingredient names against the catalog — canonical
        //    id, then alias, then vector search, then LLM adjudication, creating
        //    only what genuinely is not there. The same pipeline
        //    `ingredients/extract` uses, and for the same reason: only this side
        //    can create the row, learn the alias, and reach the embeddings that
        //    let "courgette" find "Zucchini".
        //
        //    All-or-nothing, as it is there. That is a harder failure here (the
        //    vision call is already spent) but the alternative is worse: the
        //    by-NAME persist RPC would create every unmatched ingredient in SQL,
        //    with no gray-band gate and no category — permanent bad rows in a
        //    catalog every user browses, bought with one photo of a bad page.
        const names = recipeRead.ingredients.map(
            (ingredient) => splitIngredientName(ingredient.name).name
        );
        const matched = await matchIngredients(names);

        if (matched.success === false) {
            console.error(
                "[Import] Failed to match ingredients:",
                matched.error
            );
            return {
                type: "raw" as const,
                statusCode: 500,
                data: {
                    error: "Failed to resolve the recipe's ingredients against the catalog",
                    code: "ingredient_resolution_failed",
                },
            };
        }

        const ingredientIdByName = new Map(
            matched.value.map((match) => [
                ingredientCanonicalId(match.originalName),
                match.ingredientId,
            ])
        );

        const recipe = toRecipeDto(recipeRead, ingredientIdByName);

        // 4. Hero art, on the same terms as every other recipe: fire-and-forget
        //    at a path derived from the dish NAME, which persistence then reads
        //    without waiting. `generateAndUploadRecipeImage` short-circuits on an
        //    existing object, so importing a dish the catalogue already has art
        //    for costs nothing — and because the prompt sees only the name, no
        //    part of the user's page reaches the image model.
        //
        //    Tracked so Lambda drains it instead of freezing it mid-flight.
        trackBackgroundTask(generateAndUploadRecipeImage(recipe.name)).catch(
            (error) => {
                console.error("[Import] Image generation failed:", error);
            }
        );

        const imageUrl = getRecipeImagePublicUrl(recipe.name);

        async function* importStream() {
            // The frame sequence `createRecipeStream` produces, in its order.
            // Rebuilt here rather than routed through that function because it
            // parses a live JSONL stream and this recipe is already whole.
            yield {
                type: "initial",
                name: recipe.name,
                nameEn: recipe.nameEn,
                difficulty: recipe.difficulty,
                // The yield READ OFF THE PAGE, unlike every other recipe stream
                // where it is the caller's preference. A client must take it
                // from here — there is no servings parameter to echo back.
                servings: recipe.servings,
                tags: recipe.tags,
                // Present from the first frame so a screen can badge the recipe
                // as imported before it has any of the content.
                origin: "imported",
            };

            yield {
                type: "header",
                description: recipe.description,
                shortDescription: recipe.shortDescription,
                prepTime: recipe.prepTime,
                cookTime: recipe.cookTime,
                // Repeated from `initial` because the client's recipe assembler
                // reads servings off the header frame.
                servings: recipe.servings,
            };

            yield {
                type: "nutrition",
                kcal: recipe.kcal,
                carbs: recipe.carbs,
                protein: recipe.protein,
                fat: recipe.fat,
            };

            for (const tip of recipe.tips ?? []) {
                yield { type: "tip", text: tip.text };
            }

            for (const ingredient of recipe.ingredients) {
                yield { type: "ingredient", ...ingredient };
            }

            for (const instruction of recipe.instructions) {
                yield { type: "instruction", ...instruction };
            }

            const persisted = await persistImportedRecipe(
                recipe,
                owner,
                imageUrl
            );

            if (!persisted.success) {
                console.error(
                    "[Import] Failed to persist:",
                    persisted.error.message
                );
                // Still terminal, so the client stops streaming — and still
                // carries the recipe, so a screen can offer a retry over content
                // the user has already been shown rather than dropping it.
                yield {
                    type: "complete",
                    saved: false,
                    error: "The recipe was read but could not be saved",
                    recipe,
                    origin: "imported",
                };
                return;
            }

            console.log(
                `[Import] Saved "${recipe.name}" as ${persisted.value} for profile ${owner}`
            );

            yield {
                type: "complete",
                saved: true,
                // `id`, not `recipeId`: this is the key the client's
                // done-detector reads, and getting it wrong is how escalate
                // once completed a stream with no id for a recipe that had in
                // fact been saved.
                id: persisted.value,
                recipe: { ...recipe, id: persisted.value },
                origin: "imported",
                // What the model thought of the page. A screen can use it to
                // prompt "check the quantities" on a low-confidence read rather
                // than presenting a shaky transcription as fact.
                confidence: recipeRead.confidence,
            };
        }

        return { type: "stream" as const, stream: importStream() };
    },
});
