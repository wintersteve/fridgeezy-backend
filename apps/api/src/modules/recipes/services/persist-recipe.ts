import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import {
    IngredientsRepository,
    RecipesRepository,
    UnitsRepository,
} from "@fridgeezy/supabase";
import {
    buildSuggestionSignature,
    ingredientCanonicalId,
} from "@fridgeezy/toolkit";

import { trackBackgroundTask } from "../../../background-tasks";
import {
    classifyNewIngredientComponents,
    classifyNewIngredients,
    embedNewIngredients,
} from "../../ingredients/services";
import { resolveIdentityCuisine } from "../../suggestions/services/cuisine-identity";
import { pickIdentityMatch } from "../../suggestions/services/pick-identity-match";

import {
    generateAndUploadRecipeImage,
    getRecipeImagePublicUrl,
} from "./create-recipe-image";

const DEFAULT_IMAGE_URL = "";
const unitsRepository = new UnitsRepository();

/**
 * Store the recipe's dish SIGNATURE embedding (canonical name + tags +
 * ingredients — the same text suggestions are embedded with) rather than the
 * bare name.
 *
 * A name-only vector can't recognise its own dish from anything but the exact
 * native spelling: "apple strudel" scored 0.746 against a recipe literally named
 * `Apfelstrudel` / `Apple Strudel`, missing the 0.75 search threshold and letting
 * the dish be re-suggested and re-generated. The signature puts the canonical
 * name, the cuisine/course tags and the ingredient set into the vector, and —
 * critically — makes recipe and suggestion embeddings directly comparable, which
 * is what lets dedup search both tables with one query vector.
 *
 * Best-effort: a failure leaves `fts` stale and the row can be re-embedded by
 * the backfill, so it never fails a save.
 */
async function storeRecipeSignature(
    repository: RecipesRepository,
    recipeId: string,
    recipe: GenerateRecipeResponseDto
): Promise<void> {
    const embedding = await generateEmbedding(
        buildSuggestionSignature({
            name: recipe.name,
            tags: recipe.tags ?? [],
            ingredients: recipe.ingredients.map((ingredient) => ingredient.name),
        })
    );

    const result = await repository.updateEmbedding(recipeId, embedding);

    if (!result.success) {
        console.error(
            `Failed to store embedding for recipe "${recipe.name}":`,
            result.error
        );
    }
}

/**
 * Resolve every ingredient's free-text unit to a valid abbreviation, mutating
 * each ingredient in place. Resolutions are independent, so they run in
 * parallel (a direct lookup, plus a vector-search fallback + embedding on miss)
 * instead of one round-trip per ingredient. Fails on the first unit that can't
 * be resolved.
 */
async function resolveIngredientUnits(
    ingredients: GenerateRecipeResponseDto["ingredients"]
): Promise<Result<void, PersistenceError>> {
    const resolutions = await Promise.all(
        ingredients.map(async (ingredient) => {
            // 1. Try direct lookup (canonical_id, then abbreviation)
            let unitResult = await unitsRepository.resolveUnit(ingredient.unit);

            // 2. If not found, try vector search fallback
            if (!unitResult.success) {
                const embedding = await generateEmbedding(ingredient.unit);
                unitResult = await unitsRepository.resolveUnit(
                    ingredient.unit,
                    embedding
                );
            }

            return { ingredient, unitResult };
        })
    );

    for (const { ingredient, unitResult } of resolutions) {
        if (!unitResult.success) {
            return failure(
                new PersistenceError(
                    `Unit "${ingredient.unit}" not found for ingredient "${ingredient.name}"`
                )
            );
        }
        // Update the unit to use the valid abbreviation
        ingredient.unit = unitResult.value.abbreviation;
    }

    return success(undefined);
}

/**
 * Collapse ingredients that resolve to the same DB ingredient. The
 * `recipe_ingredients` table allows only one row per (recipe, ingredient), but
 * the LLM sometimes lists an ingredient more than once (e.g. an egg "for dough"
 * and "for wash"), which resolves to a single ingredient id and would otherwise
 * violate the unique constraint. Merge duplicates by ingredientId — summing
 * quantities when the unit matches, else keeping the first. Ingredients without
 * an ingredientId are left as-is (a NULL id doesn't collide).
 */
function dedupeIngredientsById(
    ingredients: GenerateRecipeResponseDto["ingredients"]
): GenerateRecipeResponseDto["ingredients"] {
    const byId = new Map<
        string,
        GenerateRecipeResponseDto["ingredients"][number]
    >();
    const result: GenerateRecipeResponseDto["ingredients"] = [];

    for (const ingredient of ingredients) {
        const id = (ingredient as { ingredientId?: string }).ingredientId;

        if (!id) {
            result.push(ingredient);
            continue;
        }

        const existing = byId.get(id);
        if (!existing) {
            byId.set(id, ingredient);
            result.push(ingredient);
            continue;
        }

        // Same ingredient again — fold it into the first occurrence.
        if (
            existing.unit === ingredient.unit &&
            typeof existing.quantity === "number" &&
            typeof ingredient.quantity === "number"
        ) {
            existing.quantity += ingredient.quantity;
        }
    }

    return result;
}

/**
 * Persist a complete recipe to Supabase.
 *
 * This service orchestrates:
 * 1. Image generation and upload (or reuse existing image if provided)
 * 2. Database persistence via repository
 *
 * @param recipe The recipe data to persist
 * @param existingImageUrl Optional existing image URL to reuse instead of generating a new one
 * @param baseRecipeId The family base, when this recipe is a variant. Set at
 *   INSERT time rather than patched on afterwards — a variant that exists even
 *   briefly with a null base is a duplicate base recipe under the base's name,
 *   and the partial unique index rejects it.
 * @returns Result containing the recipe UUID or error
 */
/**
 * Classify whatever `persist_recipe` just invented in SQL.
 *
 * This is the OTHER ingredient pipeline. `matchIngredients` (TypeScript) hands
 * its creations straight to `classifyNewIngredients`; the SQL persist functions
 * `INSERT INTO ingredients ... ON CONFLICT DO UPDATE` inside the same statement
 * that writes the recipe, so nothing in TypeScript ever sees the new row and it
 * would otherwise stay unclassified forever — silently withdrawing the dish from
 * every dietary filter (see the divergence noted in CLAUDE.md).
 *
 * Resolved by CANONICAL id rather than by reading the rows back, because that is
 * the key the SQL just used: `ingredient_canonical_id(name)` there and
 * `ingredientCanonicalId(name)` here are required to agree, and this is one more
 * thing that breaks loudly if they ever stop.
 *
 * Passes every ingredient of the recipe, not only the new ones — telling them
 * apart would cost the read this avoids, and `classifyNewIngredients` filters to
 * the unclassified itself, so an already-known ingredient costs one indexed
 * lookup and no LLM call.
 */
async function classifyRecipeIngredients(
    recipe: GenerateRecipeResponseDto
): Promise<void> {
    const canonicalIds = [
        ...new Set(
            (recipe.ingredients ?? [])
                .map((ingredient) => ingredientCanonicalId(ingredient.name))
                .filter(Boolean)
        ),
    ];

    if (canonicalIds.length === 0) return;

    const found = await new IngredientsRepository().findByCanonicalIds(
        canonicalIds
    );

    if (found.success === false) {
        console.error(
            "[Dietary] Failed to resolve persisted ingredients:",
            found.error
        );
        return;
    }

    const ids = [...found.value.values()].map((ingredient) => ingredient.id);

    await Promise.all([
        classifyNewIngredients(ids),
        // See `classify-new-ingredient-components` — a separate call on purpose,
        // and none of these can reject, so `all` is not hiding a failure.
        classifyNewIngredientComponents(ids),
        // The THIRD thing SQL cannot do for itself, and the one that was missed.
        //
        // `persist_recipe` inserts `(canonical_id, name, category_id)` and no
        // embedding, because SQL cannot call OpenAI — so its rows are not
        // merely duplicates, they are invisible to every future match attempt:
        // `vectorSearch` can never return a null-embedding row, so the next
        // recipe naming the same thing forks a second one beside it. This hook
        // already existed to repair exactly this class of omission for dietary
        // and component classification; it stopped one column short.
        //
        // Costs ONE batched OpenAI call, and only when the recipe actually
        // invented something — see `embedNewIngredients`.
        embedNewIngredients(ids),
    ]);
}

export async function persistRecipe(
    recipe: GenerateRecipeResponseDto,
    existingImageUrl?: string,
    baseRecipeId?: string | null
): Promise<Result<string, PersistenceError>> {
    try {
        // Use existing image URL if provided, otherwise generate new one
        let imageUrl: string;

        if (existingImageUrl) {
            console.log(
                `Reusing existing image for recipe: ${recipe.name}`
            );
            imageUrl = existingImageUrl;
        } else {
            // Wait for image generation to complete
            try {
                imageUrl = await generateAndUploadRecipeImage(recipe.name);

                // If image generation returns empty string, use default
                if (!imageUrl) {
                    console.warn(
                        `Image generation returned empty URL for recipe: ${recipe.name}, using default`
                    );
                    imageUrl = DEFAULT_IMAGE_URL;
                }
            } catch (error) {
                console.error(
                    "Image generation failed, using default:",
                    error instanceof Error ? error.message : error
                );
                imageUrl = DEFAULT_IMAGE_URL;
            }
        }

        // Resolve unit strings to valid abbreviations before persisting
        const unitsResolved = await resolveIngredientUnits(recipe.ingredients);
        if (!unitsResolved.success) {
            return unitsResolved;
        }

        // Persist to database via repository
        const repository = new RecipesRepository();

        // A variant inherits its base's identity rather than re-deriving it, so
        // an escalate/modify pass that reworded a tag cannot re-home the dish.
        const identityCuisine = baseRecipeId
            ? await repository.identityCuisineOf(baseRecipeId)
            : await resolveIdentityCuisine(recipe.tags ?? []);

        const result = await repository.persist(
            recipe,
            imageUrl,
            baseRecipeId,
            identityCuisine
        );

        if (result.success) {
            await storeRecipeSignature(repository, result.value, recipe);

            // Unawaited for the same reason as the sibling call in
            // `matchIngredients`: the recipe is already written and streaming,
            // and nothing in this request reads the properties.
            trackBackgroundTask(classifyRecipeIngredients(recipe));
        }

        return result;
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}

/**
 * Persist a recipe using ingredient IDs directly (no canonical_id lookup needed).
 * Used when generating a recipe from a suggestion where ingredient IDs are already known.
 *
 * @param recipe The recipe data with ingredientId attached to each ingredient
 * @param baseRecipeId The family base, when this promotion is writing a VARIANT
 *   rather than a catalogue entry — currently the case when the dish already
 *   exists but the caller's blacklist rules that copy out. Set at INSERT time
 *   for the reason recorded on {@link persistRecipe}.
 * @returns Result containing the recipe UUID or error
 */
export async function persistRecipeWithIngredientIds(
    recipe: GenerateRecipeResponseDto,
    baseRecipeId?: string | null
): Promise<Result<string, PersistenceError>> {
    try {
        const repository = new RecipesRepository();

        // A variant inherits its base's identity rather than re-deriving it —
        // see the sibling call in `persistRecipe`. It also skips the
        // reuse-before-generate check below entirely: that check exists to find
        // the catalogue copy of this dish, and when we are writing a variant we
        // have already been handed it and already decided it will not do.
        if (baseRecipeId) {
            const identityCuisine =
                await repository.identityCuisineOf(baseRecipeId);

            recipe.ingredients = dedupeIngredientsById(recipe.ingredients);

            const imageUrl = getRecipeImagePublicUrl(recipe.name);

            const unitsResolved = await resolveIngredientUnits(
                recipe.ingredients
            );
            if (!unitsResolved.success) {
                return unitsResolved;
            }

            const variantResult = await repository.persistWithIngredientIds(
                recipe,
                imageUrl,
                identityCuisine,
                baseRecipeId
            );

            if (variantResult.success) {
                await storeRecipeSignature(
                    repository,
                    variantResult.value,
                    recipe
                );
            }

            return variantResult;
        }

        // Promotion is not naturally idempotent: the suggestion row is deleted
        // once the recipe exists, so a repeated (or concurrent, or retried)
        // generation of the same dish has nothing to collide with and `recipes`
        // enforces no uniqueness on the name — every attempt used to insert
        // another base row under the same name. Reuse the recipe already there.
        //
        // Keyed on difficulty as well: easy/medium/hard are genuinely different
        // recipes for the same dish, and only BASE rows are considered, so AI
        // variants (which deliberately keep the base's name) are never returned.
        // Keyed on the CUISINE as well since 20260812000003. Without it,
        // promoting a Kazakh Manti suggestion returned the existing Turkish
        // Manti recipe id — and promotion then deletes the suggestion, so the
        // Kazakh dish was destroyed rather than merely hidden.
        const identityCuisine = await resolveIdentityCuisine(recipe.tags ?? []);

        const existing = await repository.findBaseRecipes(
            [recipe.name, recipe.nameEn],
            recipe.difficulty
        );

        if (!existing.success) {
            console.error(
                `Existing-recipe lookup failed for "${recipe.name}":`,
                existing.error.message
            );
        } else if (existing.value.length > 0) {
            const match = await pickIdentityMatch(
                { name: recipe.name, cuisine: identityCuisine },
                existing.value.map((row) => ({
                    row,
                    identityCuisine: row.identityCuisine,
                    label: row.name,
                }))
            );

            if (match) {
                console.log(
                    `Recipe "${recipe.name}" (${recipe.difficulty}) already exists — reusing ${match.id}`
                );
                return success(match.id);
            }
        }

        // Collapse ingredients that map to the same DB ingredient so the insert
        // doesn't violate recipe_ingredients' (recipe_id, ingredient_id) unique key.
        recipe.ingredients = dedupeIngredientsById(recipe.ingredients);

        // The recipe stream already kicked off image generation (fire-and-forget)
        // for this exact name, and it lands at a deterministic path. Use that URL
        // now instead of generating a SECOND time and blocking the save on the
        // (slow, costly) image model — the async upload backfills the file.
        const imageUrl = getRecipeImagePublicUrl(recipe.name);

        // Resolve unit strings to valid abbreviations before persisting
        const unitsResolved = await resolveIngredientUnits(recipe.ingredients);
        if (!unitsResolved.success) {
            return unitsResolved;
        }

        // Persist using ingredient IDs
        const result = await repository.persistWithIngredientIds(
            recipe,
            imageUrl,
            identityCuisine
        );

        if (result.success) {
            await storeRecipeSignature(repository, result.value, recipe);

            // Unawaited for the same reason as the sibling call in
            // `matchIngredients`: the recipe is already written and streaming,
            // and nothing in this request reads the properties.
            trackBackgroundTask(classifyRecipeIngredients(recipe));
        }

        return result;
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}

/**
 * Persist a recipe a user brought in from a photograph.
 *
 * A third persist path rather than a flag on
 * {@link persistRecipeWithIngredientIds}, because almost every decision that
 * function makes is about the shared catalogue and every one of them is wrong
 * here:
 *
 * - **No reuse-before-persist.** That path looks for an existing base recipe of
 *   the same name and difficulty and hands its id back instead of writing. For a
 *   promotion that is right — the dish is the catalogue's and paying twice for it
 *   is waste. For an import it would discard the user's page and return the
 *   app's own lasagna, which is the one outcome the feature must never produce.
 *   `recipes_dish_identity_difficulty_unique` no longer covers owned rows
 *   (20260815000005) precisely so that this insert can go through.
 * - **No dedup embedding.** {@link storeRecipeSignature} exists to feed
 *   `search_recipes`, which is catalogue dedup, and which now excludes owned
 *   rows by definition. Writing one would be an OpenAI call per import whose
 *   only reader has been told to ignore it. The client's own recipe search goes
 *   straight at the table with `ilike` and picks imports up through RLS, so
 *   nothing the user can see depends on the vector.
 * - **No variant base.** An import heads its own family (`base_recipe_id NULL`),
 *   as `20260815000003` records: it is a dish the user brought in, not a version
 *   of one already here, and it can carry variants of its own.
 *
 * What it DOES keep is unit resolution and ingredient collapsing, which are
 * about the shape of the rows rather than about where the recipe came from — and
 * are, if anything, more necessary here, since the ingredient list was read off
 * a page rather than written to a schema.
 *
 * @param recipe The recipe read from the image, with ingredient ids attached.
 * @param createdBy The importing profile. Required: the database rejects an
 *   `origin = 'imported'` row without one, which is what stops a failure to
 *   resolve the caller from silently publishing their recipe to everybody.
 * @param imageUrl The deterministic hero URL for this dish name. The use case
 *   has already kicked off the generation that backfills it.
 */
export async function persistImportedRecipe(
    recipe: GenerateRecipeResponseDto,
    createdBy: string,
    imageUrl: string
): Promise<Result<string, PersistenceError>> {
    try {
        const repository = new RecipesRepository();

        recipe.ingredients = dedupeIngredientsById(recipe.ingredients);

        const unitsResolved = await resolveIngredientUnits(recipe.ingredients);
        if (!unitsResolved.success) {
            return unitsResolved;
        }

        // Derived from the tags the reader assigned, exactly as the catalogue
        // paths do. It costs nothing and keeps the row's identity columns
        // populated the same way every other row's are — so an import that a
        // user later wants folded into the catalogue is not a special case.
        const identityCuisine = await resolveIdentityCuisine(recipe.tags ?? []);

        return await repository.persistWithIngredientIds(
            recipe,
            imageUrl,
            identityCuisine,
            null,
            { origin: "imported", createdBy }
        );
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to persist imported recipe: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
