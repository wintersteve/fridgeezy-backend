import { RecipeSuggestion, RecipeSuggestionInsertPayload } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

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
     * Every suggestion stored under this canonical name.
     *
     * 0..N, not 0-or-1: dish identity is `(canonical_id, identity_cuisine)`, so
     * one name can legitimately carry two dishes (Turkish Mantı, Kazakh Manti).
     *
     * @param name The suggestion name
     * @returns Result containing the matching suggestions, oldest first
     */
    findByCanonicalName(
        name: string
    ): Promise<Result<RecipeSuggestion[], DomainError>>;

    /**
     * Find all suggestions
     *
     * @returns Result containing array of all suggestions
     */
    findAll(): Promise<Result<RecipeSuggestion[], DomainError>>;

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

    /**
     * Persist a suggestion with its ingredient and tag relations atomically
     *
     * This method creates a suggestion and its associations in a single transaction.
     *
     * @param suggestion The suggestion data to persist
     * @param ingredientIds Array of ingredient UUIDs to associate
     * @param tagIds Array of tag UUIDs to associate
     * @param embedding Precomputed name embedding (text-embedding-3-small, 1536-dim)
     * @param nameEn Optional English name of the dish
     * @param identityCuisine The cuisine half of the dish's identity
     * @returns Result containing the created suggestion UUID
     */
    persistWithRelations(
        suggestion: RecipeSuggestionInsertPayload,
        ingredientIds: string[],
        tagIds: string[],
        embedding: number[],
        nameEn?: string,
        identityCuisine?: string | null
    ): Promise<Result<string, DomainError>>;
}
