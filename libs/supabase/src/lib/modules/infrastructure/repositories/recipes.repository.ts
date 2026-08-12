import {
    failure,
    IRecipesRepository,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import { canonicalizeName } from "@fridgeezy/toolkit";

import { supabaseAdmin } from "../../client";

/** Escape a value for use inside a double-quoted PostgREST `or(...)` filter. */
function quoteFilterValue(value: string): string {
    return value.replace(/([\\"])/g, "\\$1");
}

/**
 * Deterministic slug — MUST stay byte-identical to the Postgres
 * `normalize_to_canonical_id(text)` function, because it is compared against the
 * generated `recipes.canonical_id` column that function produces.
 *
 * ⚠️ Do NOT "simplify" this to `canonicalizeName` from `@fridgeezy/toolkit`,
 * which is imported into this very file. They look interchangeable and are not:
 * `canonicalizeName` trims leading/trailing underscores, and this deliberately
 * does not. For a name like `"Crème Brûlée "` the column holds `creme_brulee_`
 * while `canonicalizeName` yields `creme_brulee`, so swapping them makes
 * `findByCanonicalName` miss and create the duplicate it exists to prevent.
 *
 * Rule of thumb: comparing against a DB-generated column -> use this;
 * comparing two JS-normalized names -> use `canonicalizeName`.
 */
const sqlCanonicalId = (input: string): string =>
    input
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .toLowerCase();

export class RecipesRepository implements IRecipesRepository {
    /**
     * Persist a complete recipe with all related entities.
     *
     * Calls the persist_recipe RPC function which atomically creates:
     * - Recipe record
     * - Ingredient records (find or create)
     * - Recipe-ingredient associations
     * - Instruction records
     * - Tag records (find or create)
     * - Recipe-tag associations
     */
    async persist(
        recipe: GenerateRecipeResponseDto,
        imageUrl: string,
        /**
         * The family base, when persisting a variant (modify / escalate). Goes
         * into the INSERT rather than being patched on afterwards: a row that is
         * briefly `base_recipe_id NULL` is, to the database, a second base recipe
         * under the base's name, and the partial unique index
         * `recipes_canonical_id_difficulty_unique` rejects it before it can be
         * re-parented. Resolve it with
         * {@link RecipesRepository.resolveVariantBase}.
         */
        baseRecipeId?: string | null,
        /**
         * The cuisine half of dish identity. In the INSERT, never a follow-up
         * UPDATE: a base row committed with a null here is, to
         * `recipes_dish_identity_difficulty_unique`, the "unknown cuisine" copy
         * of this dish, and a failed patch would leave a permanent duplicate.
         *
         * Appended rather than slotted in beside the other identity fields, so
         * every existing positional call site keeps meaning what it meant.
         */
        identityCuisine?: string | null
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data, error } = await supabaseAdmin.rpc("persist_recipe", {
                p_name: recipe.name,
                p_description: recipe.description || "",
                p_difficulty: recipe.difficulty,
                p_servings: recipe.servings,
                p_prep_time: `${recipe.prepTime} min`,
                p_cook_time: `${recipe.cookTime} min`,
                p_kcal: recipe.kcal,
                p_carbs: recipe.carbs,
                p_protein: recipe.protein,
                p_fat: recipe.fat,
                p_tips: recipe.tips?.map((tip) => tip.text) || [],
                p_image: imageUrl,
                p_ingredients: recipe.ingredients,
                p_instructions: recipe.instructions.map((inst, idx) => ({
                    step_number: idx + 1,
                    text: inst.text,
                    ingredients: inst.ingredients || [],
                    // snake_case because this is the JSONB the SQL reads by key,
                    // not a TS object — `persist_recipe` looks up
                    // `duration_seconds`. Null rather than omitted so the shape
                    // stays uniform across steps.
                    duration_seconds: inst.durationSeconds ?? null,
                    temperature_c: inst.temperatureC ?? null,
                    equipment: inst.equipment ?? null,
                })),
                p_tags: recipe.tags || [],
                // Both omitted rather than nulled when absent, so the SQL
                // defaults apply — the RPC types them as optional, not nullable.
                p_name_en: recipe.nameEn ?? undefined,
                p_base_recipe_id: baseRecipeId ?? undefined,
                p_identity_cuisine: identityCuisine ?? undefined,
            });

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            if (!data) {
                return failure(
                    new PersistenceError(
                        "Failed to persist recipe: no ID returned"
                    )
                );
            }

            const recipeId = data as string;

            await this.writeShortDescription(recipeId, recipe.shortDescription);

            return success(recipeId);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * A recipe's identity cuisine, for a variant to inherit from its base.
     *
     * A variant must not re-derive this from its own tags: modify and escalate
     * both rewrite the tag list, and a reworded cuisine would silently re-home
     * the dish away from the family it belongs to. Null on any error — unknown
     * merges, which is the safe direction.
     */
    async identityCuisineOf(recipeId: string): Promise<string | null> {
        const { data, error } = await supabaseAdmin
            .from("recipes")
            .select("identity_cuisine")
            .eq("id", recipeId)
            .maybeSingle();

        if (error) {
            console.warn(
                `[RecipesRepository] Could not read identity_cuisine for ${recipeId}: ${error.message}`
            );
            return null;
        }

        return data?.identity_cuisine ?? null;
    }

    /**
     * Write the card-sized description once the recipe row exists.
     *
     * Not a `persist_recipe*` parameter: adding one to those creates a second
     * overload and makes the RPC ambiguous unless the whole body is re-declared.
     * Best-effort, like `updateEmbedding` — a failure leaves the column null and
     * the card falls back to `description`, so it never fails a generation.
     */
    private async writeShortDescription(
        recipeId: string,
        shortDescription?: string | null
    ): Promise<void> {
        if (!shortDescription) {
            return;
        }

        const { error } = await supabaseAdmin
            .from("recipes")
            .update({ short_description: shortDescription })
            .eq("id", recipeId);

        if (error) {
            console.warn(
                `[RecipesRepository] Failed to write short_description for ${recipeId}: ${error.message}`
            );
        }
    }

    /**
     * Set (or replace) a recipe's fts embedding after it has been persisted.
     * The app computes the embedding (text-embedding-3-small) and stores it here
     * so Postgres never calls OpenAI. Best-effort: the caller treats a failure as
     * non-fatal (the row can be re-embedded by the backfill).
     */
    async updateEmbedding(
        recipeId: string,
        embedding: number[]
    ): Promise<Result<void, PersistenceError>> {
        try {
            const { error } = await supabaseAdmin
                .from("recipes")
                .update({ fts: JSON.stringify(embedding) })
                .eq("id", recipeId);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to update recipe embedding: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Find a BASE recipe (never a variant) already in the catalog under any of
     * `names`, optionally pinned to one difficulty.
     *
     * The ilike filter only narrows the rows the DB returns; the normalized
     * comparison below is what actually decides a match, so a stray LIKE
     * wildcard in a dish name can over-fetch but never mis-identify. Both `name`
     * and `name_en` are checked so a native name and its English translation
     * resolve to the same dish.
     *
     * ## Why this normalizes in JS rather than querying `canonical_id`
     *
     * It is NOT because the column is missing — an earlier version of this
     * comment said `recipes` has no canonical_id, and that has been false since
     * `20260801000007` added it as a generated column with an index. The reasons
     * it stays this way:
     *
     * - **`name_en` has no generated canonical**, so half the lookup has to
     *   normalize in JS regardless. Moving only the `name` half to the column
     *   would put TWO rules in one function — `sqlCanonicalId` against the
     *   column and `canonicalizeName` against `name_en` — which is worse than
     *   one rule applied consistently to both sides.
     * - **The two rules disagree on trimming.** `normalize_to_canonical_id` does
     *   not trim, so a row named `"Tarte Tatin "` stores `tarte_tatin_` while a
     *   query for `"Tarte Tatin"` computes `tarte_tatin`. Applying one rule to
     *   both sides here sidesteps that; querying the column would have to carry
     *   both spellings.
     *
     * This is self-consistent and correct, but note it is a DIFFERENT scheme
     * from {@link findByCanonicalName}, which compares `sqlCanonicalId` against
     * the column. Both find the same rows — each applies its rule to both sides
     * — so this is not a live defect, but do not assume one can be swapped for
     * the other. Revisit the query shape when this function is widened to return
     * every candidate rather than the first match.
     */
    async findBaseRecipes(
        names: Array<string | null | undefined>,
        difficulty?: GenerateRecipeResponseDto["difficulty"]
    ): Promise<
        Result<
            Array<{ id: string; name: string; identityCuisine: string | null }>,
            PersistenceError
        >
    > {
        const wanted = names
            .map((name) => canonicalizeName(name))
            .filter((name): name is string => !!name);

        if (wanted.length === 0) {
            return success([]);
        }

        try {
            const filter = names
                .map((name) => name?.trim())
                .filter((name): name is string => !!name)
                .flatMap((name) => [
                    `name.ilike."${quoteFilterValue(name)}"`,
                    `name_en.ilike."${quoteFilterValue(name)}"`,
                ])
                .join(",");

            let query = supabaseAdmin
                .from("recipes")
                .select("id, name, name_en, identity_cuisine")
                .is("base_recipe_id", null)
                .or(filter);

            if (difficulty) {
                query = query.eq("difficulty", difficulty);
            }

            const { data, error } = await query;

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            // `filter`, not `find`: one canonical name can carry two dishes that
            // differ only by cuisine, and choosing between them is the caller's
            // job (`pickIdentityMatch`). `identity_cuisine` rides along in the
            // select that was already happening.
            const matches = (data ?? [])
                .filter(
                    (row) =>
                        wanted.includes(canonicalizeName(row.name) ?? "") ||
                        wanted.includes(canonicalizeName(row.name_en) ?? "")
                )
                .map((row) => ({
                    id: row.id,
                    name: row.name,
                    identityCuisine: row.identity_cuisine,
                }));

            return success(matches);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to look up existing recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Persist a recipe using ingredient IDs directly (no canonical_id lookup).
     * Used when generating from a suggestion where ingredient IDs are already known.
     *
     * Calls the persist_recipe_with_ingredient_ids RPC function which:
     * - Uses ingredient_id directly instead of looking up by name
     * - Uses ingredient_ids (UUIDs) for instructions instead of name-to-id mapping
     * - Tags still use create-if-not-exists pattern
     */
    async persistWithIngredientIds(
        recipe: GenerateRecipeResponseDto,
        imageUrl: string,
        /** See {@link RecipesRepository.persist}. */
        identityCuisine?: string | null
    ): Promise<Result<string, PersistenceError>> {
        try {
            // Type assertion needed until database types are regenerated after migration
            const { data, error } = await (supabaseAdmin.rpc as any)(
                "persist_recipe_with_ingredient_ids",
                {
                    p_name: recipe.name,
                    p_description: recipe.description || "",
                    p_difficulty: recipe.difficulty,
                    p_servings: recipe.servings,
                    p_prep_time: `${recipe.prepTime} min`,
                    p_cook_time: `${recipe.cookTime} min`,
                    p_kcal: recipe.kcal,
                    p_carbs: recipe.carbs,
                    p_protein: recipe.protein,
                    p_fat: recipe.fat,
                    p_tips: recipe.tips?.map((tip) => tip.text) || [],
                    p_image: imageUrl,
                    p_ingredients: recipe.ingredients.map((ing) => ({
                        ingredient_id: (ing as any).ingredientId,
                        quantity: ing.quantity,
                        unit: ing.unit,
                        comment: (ing as any).comment || null,
                    })),
                    p_instructions: recipe.instructions.map((inst, idx) => ({
                        step_number: idx + 1,
                        text: inst.text,
                        ingredient_ids: (inst as any).ingredientIds || [],
                        // See the sibling mapping in persistWithRelations.
                        duration_seconds:
                            (inst as any).durationSeconds ?? null,
                        temperature_c: (inst as any).temperatureC ?? null,
                        equipment: (inst as any).equipment ?? null,
                    })),
                    p_tags: recipe.tags || [],
                    p_name_en: recipe.nameEn ?? null,
                    p_identity_cuisine: identityCuisine ?? undefined,
                }
            );

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            if (!data) {
                return failure(
                    new PersistenceError(
                        "Failed to persist recipe: no ID returned"
                    )
                );
            }

            const recipeId = data as string;

            await this.writeShortDescription(recipeId, recipe.shortDescription);

            return success(recipeId);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to persist recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * The base of the family `sourceRecipeId` belongs to — itself if it is a
     * base, otherwise its own base. Families stay flat: modifying a variant
     * points the new row at that variant's base, never at the variant.
     *
     * Resolve this BEFORE persisting and hand it to {@link persist}. There used
     * to be a `markAsVariant` that inserted the row unparented and re-parented it
     * in a second statement; between the two, the row is a second base recipe
     * under the base's name, and the partial unique index
     * `recipes_canonical_id_difficulty_unique` rejects it outright — which is
     * what broke difficulty escalation. Set the parent in the INSERT and that
     * window never exists.
     */
    async resolveVariantBase(
        sourceRecipeId: string
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data: source, error } = await supabaseAdmin
                .from("recipes")
                .select("base_recipe_id")
                .eq("id", sourceRecipeId)
                .maybeSingle();

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            return success(source?.base_recipe_id ?? sourceRecipeId);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to resolve variant base: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * The recipe a suggestion was already promoted into, if any.
     *
     * Promotion is one-way and deletes the suggestion once the recipe exists, so
     * a repeated promote of the same id would otherwise regenerate a recipe that
     * has already been written and paid for.
     *
     * @returns Result containing the recipe UUID, or null when never promoted
     */
    async findBySuggestionId(
        suggestionId: string
    ): Promise<Result<string | null, PersistenceError>> {
        try {
            // Type assertion needed until database types are regenerated after
            // the source_suggestion_id migration.
            const { data, error } = await (supabaseAdmin as any)
                .from("recipes")
                .select("id")
                .eq("source_suggestion_id", suggestionId)
                .maybeSingle();

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            return success((data?.id as string) ?? null);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to look up promoted recipe: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Record which suggestion a freshly persisted recipe was promoted from. Must
     * run before the suggestion is deleted, since that id is the only handle a
     * returning client has on the recipe.
     */
    async markPromotedFrom(
        recipeId: string,
        suggestionId: string
    ): Promise<Result<void, PersistenceError>> {
        try {
            // Type assertion needed until database types are regenerated after
            // the source_suggestion_id migration.
            const { error } = await (supabaseAdmin as any)
                .from("recipes")
                .update({ source_suggestion_id: suggestionId })
                .eq("id", recipeId);

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to record promoted suggestion: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Find an existing NON-variant recipe with the same canonical name (the
     * deterministic slug of the name). Used to reuse an already-generated recipe
     * instead of producing a duplicate. Variants (base_recipe_id set) share
     * names by design and are excluded. Returns the recipe id or null.
     */
    async findByCanonicalName(
        name: string
    ): Promise<Result<string | null, PersistenceError>> {
        try {
            const canonicalId = sqlCanonicalId(name);
            // Type assertion needed until database types are regenerated after
            // the canonical_id migration.
            const { data, error } = await (supabaseAdmin as any)
                .from("recipes")
                .select("id")
                .eq("canonical_id", canonicalId)
                .is("base_recipe_id", null)
                .order("created_at", { ascending: true })
                .limit(1);

            if (error) {
                return failure(
                    new PersistenceError(`Database error: ${error.message}`)
                );
            }

            return success((data?.[0]?.id as string) ?? null);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to look up recipe by canonical name: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

}
