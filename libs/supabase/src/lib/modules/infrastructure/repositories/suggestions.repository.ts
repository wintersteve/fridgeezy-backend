import {
    ConflictError,
    failure,
    ISuggestionsRepository,
    NotFoundError,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import {
    RecipeSuggestion,
    RecipeSuggestionInsertPayload,
} from "@fridgeezy/types";

import { supabase } from "../../client";

export class SuggestionsRepository implements ISuggestionsRepository {
    /**
     * Find a suggestion by its ID
     */
    async findById(
        id: string
    ): Promise<Result<RecipeSuggestion | null, PersistenceError>> {
        try {
            const { data, error } = await supabase
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
     * Find a suggestion by its name using canonical_id for consistent matching
     */
    async findByName(
        name: string
    ): Promise<Result<RecipeSuggestion | null, PersistenceError>> {
        try {
            // Normalize the name to canonical_id format for matching
            const canonicalId = name
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_");

            const { data, error } = await supabase
                .from("recipe_suggestions")
                .select("*")
                .eq("canonical_id", canonicalId)
                .maybeSingle(); // Use maybeSingle to handle 0 or 1 results

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return success(null);
            }

            return success(data);
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
            const { data, error } = await supabase
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
            const { data, error } = await supabase
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
            const { data, error } = await supabase
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
            const { error } = await supabase
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
        query: string,
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
            const { data, error } = await supabase.rpc(
                "search_recipe_suggestions",
                {
                    search_query: query,
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
        nameEn?: string
    ): Promise<Result<string, PersistenceError>> {
        try {
            const { data, error } = await supabase.rpc("persist_suggestion", {
                p_name: suggestion.name,
                p_description: suggestion.description ?? "",
                p_difficulty: suggestion.difficulty as "easy" | "medium" | "hard",
                p_ingredient_ids: ingredientIds,
                p_tag_ids: tagIds,
                p_name_en: nameEn ?? null,
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
