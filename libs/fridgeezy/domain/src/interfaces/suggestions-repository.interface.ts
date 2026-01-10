import { RecipeSuggestion } from "../types";
import { DomainError, Result } from "../shared";

/**
 * Repository interface for RecipeSuggestion aggregate.
 *
 * Defines the contract that infrastructure implementations must fulfill.
 * This interface lives in the domain layer (Dependency Inversion Principle).
 *
 * @example
 * ```typescript
 * class SupabaseSuggestionsRepository implements ISuggestionsRepository {
 *   async findById(id: string): Promise<Result<RecipeSuggestion | null, DomainError>> {
 *     // Implementation using Supabase
 *   }
 * }
 * ```
 */
export interface ISuggestionsRepository {
    /**
     * Find a suggestion by its ID
     *
     * @param id The suggestion ID
     * @returns Result containing the suggestion or null if not found
     */
    findById(id: string): Promise<Result<RecipeSuggestion | null, DomainError>>;

    /**
     * Find a suggestion by its name
     *
     * @param name The suggestion name
     * @returns Result containing the suggestion or null if not found
     */
    findByName(
        name: string
    ): Promise<Result<RecipeSuggestion | null, DomainError>>;

    /**
     * Find all suggestions
     *
     * @returns Result containing array of all suggestions
     */
    findAll(): Promise<Result<RecipeSuggestion[], DomainError>>;

    /**
     * Find suggestions that have not been promoted
     *
     * @returns Result containing array of unpromoted suggestions
     */
    findUnpromoted(): Promise<Result<RecipeSuggestion[], DomainError>>;

    /**
     * Create a new suggestion
     *
     * @param suggestion The suggestion entity to create
     * @returns Result containing the created suggestion
     */
    create(
        suggestion: RecipeSuggestion
    ): Promise<Result<RecipeSuggestion, DomainError>>;

    /**
     * Update an existing suggestion
     *
     * Note: The entity should already have the updated state.
     * This method persists those changes.
     *
     * @param suggestion The suggestion entity with updated state
     * @returns Result containing the updated suggestion
     */
    update(
        suggestion: RecipeSuggestion
    ): Promise<Result<RecipeSuggestion, DomainError>>;

    /**
     * Delete a suggestion by its ID
     *
     * @param id The suggestion ID to delete
     * @returns Result indicating success or failure
     */
    delete(id: string): Promise<Result<void, DomainError>>;
}
