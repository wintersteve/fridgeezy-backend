import {
    ConflictError,
    eventDispatcher,
    failure,
    ISuggestionsRepository,
    NotFoundError,
    PersistenceError,
    RecipeSuggestion,
    Result,
    success,
} from "@fridgeezy/domain";
import { fromPersistence, toPersistence } from "@fridgeezy/toolkit";
import { injectable } from "tsyringe";

import { supabase } from "../../client";

@injectable()
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

            // Convert from snake_case (database) to camelCase (domain)
            const domainData = fromPersistence(data);

            if (!domainData) {
                return success(null);
            }

            // Reconstitute domain entity
            const suggestion = RecipeSuggestion.fromPersistence(domainData);

            return success(suggestion);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find suggestion by id: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Find a suggestion by its name
     */
    async findByName(
        name: string
    ): Promise<Result<RecipeSuggestion | null, PersistenceError>> {
        try {
            const { data, error } = await supabase
                .from("recipe_suggestions")
                .select("*")
                .eq("name", name)
                .maybeSingle(); // Use maybeSingle to handle 0 or 1 results

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data) {
                return success(null);
            }

            const domainData = fromPersistence(data);

            if (!domainData) {
                return success(null);
            }

            const suggestion = RecipeSuggestion.fromPersistence(domainData);

            return success(suggestion);
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

            const suggestions = (data || [])
                .map((item) => fromPersistence(item))
                .filter(
                    (
                        domainData
                    ): domainData is NonNullable<typeof domainData> =>
                        domainData !== null
                )
                .map((domainData) =>
                    RecipeSuggestion.fromPersistence(domainData)
                );

            return success(suggestions);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to fetch suggestions: ${error instanceof Error ? error.message : "Unknown error"}`
                )
            );
        }
    }

    /**
     * Find suggestions that haven't been promoted
     */
    async findUnpromoted(): Promise<
        Result<RecipeSuggestion[], PersistenceError>
    > {
        try {
            const { data, error } = await supabase
                .from("recipe_suggestions")
                .select("*")
                .is("promoted_to_recipe_id", null)
                .order("created_at", { ascending: false });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const suggestions = (data || [])
                .map((item) => fromPersistence(item))
                .filter(
                    (
                        domainData
                    ): domainData is NonNullable<typeof domainData> =>
                        domainData !== null
                )
                .map((domainData) =>
                    RecipeSuggestion.fromPersistence(domainData)
                );

            return success(suggestions);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to fetch unpromoted suggestions: ${error instanceof Error ? error.message : "Unknown error"}`
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
            // Convert domain entity to persistence format
            const persistenceData = toPersistence(suggestion.toPersistence());

            const { data, error } = await supabase
                .from("recipe_suggestions")
                .insert(persistenceData)
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

            // Reconstitute the created entity
            const domainData = fromPersistence(data);

            if (!domainData) {
                return failure(
                    new PersistenceError(
                        "Failed to reconstitute created entity"
                    )
                );
            }

            const created = RecipeSuggestion.fromPersistence(domainData);

            // Dispatch domain events
            for (const event of suggestion.domainEvents) {
                await eventDispatcher.dispatch(event);
            }
            suggestion.clearDomainEvents();

            return success(created);
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
            // Convert domain entity to persistence format
            const persistenceData = toPersistence(suggestion.toPersistence());

            const { data, error } = await supabase
                .from("recipe_suggestions")
                .update(persistenceData)
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

            // Reconstitute the updated entity
            const domainData = fromPersistence(data);

            if (!domainData) {
                return failure(
                    new PersistenceError(
                        "Failed to reconstitute updated entity"
                    )
                );
            }

            const updated = RecipeSuggestion.fromPersistence(domainData);

            // Dispatch domain events
            for (const event of suggestion.domainEvents) {
                await eventDispatcher.dispatch(event);
            }
            suggestion.clearDomainEvents();

            return success(updated);
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
}
