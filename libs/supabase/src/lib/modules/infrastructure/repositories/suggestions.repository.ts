import {
    ConflictError,
    failure,
    ISuggestionsRepository,
    NotFoundError,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { suggestionCanonicalId } from "@fridgeezy/toolkit";
import {
    RecipeSuggestion,
    RecipeSuggestionInsertPayload,
} from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

export class SuggestionsRepository implements ISuggestionsRepository {
    /**
     * Find a suggestion by its ID
     */
    async findById(
        id: string
    ): Promise<Result<RecipeSuggestion | null, PersistenceError>> {
        try {
            const { data, error } = await supabaseAdmin
                .from("recipe_suggestions")
                .select("*")
                .eq("id", id)
                .single();

            if (error) {
                // PGRST116 = PostgREST error code for "not found"
                if (error.code === "PGRST116") {
                    return success(null);
                }
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return success(null);
            }

            return success(data);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find suggestion by id: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Every suggestion stored under this canonical name — 0..N rows.
     *
     * Returned as a list rather than `maybeSingle()` because identity is
     * `(canonical_id, identity_cuisine)` since `20260812000003`: one name can
     * legitimately carry two dishes (Turkish Mantı and Kazakh Manti). Picking
     * among them is `pickIdentityMatch`'s job, not this one's — `identity_cuisine`
     * rides along in the `select("*")` that was already happening, so the
     * tiebreak costs no extra round trip.
     *
     * `suggestionCanonicalId` is byte-identical to the
     * `set_recipe_suggestion_canonical_id` trigger that fills the column, which
     * is the only reason this lookup hits. It is NOT `canonicalizeName` — that
     * strips edge underscores and the trigger does not, so it would miss a row
     * stored as `sunomono_`. See the helper's docblock for the three rules and
     * which column each one belongs to.
     */
    async findByCanonicalName(
        name: string
    ): Promise<Result<RecipeSuggestion[], PersistenceError>> {
        try {
            const canonicalId = suggestionCanonicalId(name);

            if (!canonicalId) {
                return success([]);
            }

            const { data, error } = await supabaseAdmin
                .from("recipe_suggestions")
                .select("*")
                .eq("canonical_id", canonicalId)
                // Oldest first, so a tie is broken by the row that has been in
                // the catalogue longest rather than by whatever order the
                // planner produced.
                .order("created_at", { ascending: true });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data ?? []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find suggestion by name: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Find all suggestions
     */
    async findAll(): Promise<Result<RecipeSuggestion[], PersistenceError>> {
        try {
            const { data, error } = await supabaseAdmin
                .from("recipe_suggestions")
                .select("*")
                .order("created_at", { ascending: false });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data || []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to fetch suggestions: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }


    /**
     * Create a new suggestion
     */
    async create(
        suggestion: RecipeSuggestion
    ): Promise<Result<RecipeSuggestion, PersistenceError | ConflictError>> {
        try {
            const { data, error } = await supabaseAdmin
                .from("recipe_suggestions")
                .insert(suggestion)
                .select("*")
                .single();

            if (error) {
                // 23505 = PostgreSQL unique constraint violation
                if (error.code === "23505") {
                    return failure(
                        new ConflictError(
                            "Suggestion with this name already exists",
                            "name"
                        )
                    );
                }
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return failure(new PersistenceError("Failed to create entity"));
            }

            return success(data);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to create suggestion: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Update an existing suggestion
     */
    async update(
        suggestion: RecipeSuggestion
    ): Promise<Result<RecipeSuggestion, PersistenceError | NotFoundError>> {
        try {
            const { data, error } = await supabaseAdmin
                .from("recipe_suggestions")
                .update(suggestion)
                .eq("id", suggestion.id)
                .select("*")
                .single();

            if (error) {
                if (error.code === "PGRST116") {
                    return failure(
                        new NotFoundError("RecipeSuggestion", suggestion.id)
                    );
                }
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return failure(new PersistenceError("Failed to update entity"));
            }

            return success(data);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to update suggestion: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Delete a suggestion by its ID
     */
    async delete(id: string): Promise<Result<void, PersistenceError>> {
        try {
            const { error } = await supabaseAdmin
                .from("recipe_suggestions")
                .delete()
                .eq("id", id);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to delete suggestion: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Search for similar suggestions using vector similarity
     */
    async searchSimilar(
        embedding: number[],
        matchThreshold = 0.95,
        matchCount = 1
    ): Promise<
        Result<
            Array<{
                id: string;
                name: string;
                description: string;
                difficulty: string;
                score: number;
            }>,
            PersistenceError
        >
    > {
        try {
            const { data, error } = await supabaseAdmin.rpc(
                "search_recipe_suggestions",
                {
                    query_embedding: JSON.stringify(embedding),
                    match_threshold: matchThreshold,
                    match_count: matchCount,
                }
            ) as {
                data: Array<{
                    id: string;
                    name: string;
                    description: string;
                    difficulty: string;
                    score: number;
                }> | null;
                error: any;
            };

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data || []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to search similar suggestions: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Persist a suggestion with its ingredient and tag relations atomically
     */
    async persistWithRelations(
        suggestion: Omit<RecipeSuggestionInsertPayload, "canonical_id">,
        ingredientIds: string[],
        tagIds: string[],
        embedding: number[],
        nameEn?: string,
        /**
         * Half of the dish's identity. Goes into the INSERT rather than a
         * follow-up UPDATE: a row committed with a null here is, to
         * `recipe_suggestions_dish_identity_unique`, the "unknown cuisine" copy
         * of this dish, so a failed follow-up would leave a permanent duplicate.
         */
        identityCuisine?: string | null
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data, error } = await supabaseAdmin.rpc("persist_suggestion", {
                p_name: suggestion.name,
                p_description: suggestion.description ?? "",
                p_difficulty: suggestion.difficulty as "easy" | "medium" | "hard",
                p_ingredient_ids: ingredientIds,
                p_tag_ids: tagIds,
                p_embedding: JSON.stringify(embedding),
                // Omit when absent so the SQL default (null) applies
                p_name_en: nameEn ?? undefined,
                p_identity_cuisine: identityCuisine ?? undefined,
            });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return failure(
                    new PersistenceError("Failed to persist suggestion")
                );
            }

            return success(data as string);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to persist suggestion with relations: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }
}
