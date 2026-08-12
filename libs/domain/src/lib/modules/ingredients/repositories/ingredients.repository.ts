import { Ingredient, IngredientInsertPayload } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

export interface VectorMatch {
    ingredient: Ingredient;
    similarity: number;
}

export interface IIngredientsRepository {
    /**
     * Find ingredients by their exact names (batch operation)
     * @param names Array of ingredient names to search for
     * @returns Map of name → Ingredient for found matches
     */
    findByNames(
        names: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>>;

    /**
     * Find ingredients by their primary keys (batch operation)
     * @param ids Array of ingredient ids to fetch
     * @returns Map of id → Ingredient for found matches
     */
    findByIds(ids: string[]): Promise<Result<Map<string, Ingredient>, DomainError>>;

    /**
     * Find ingredients by matching aliases (batch operation)
     * @param aliases Array of alias names to search for
     * @returns Map of alias → ingredient_id for found matches
     */
    findByAliases(
        aliases: string[]
    ): Promise<Result<Map<string, string>, DomainError>>;

    /**
     * Record a learned alias → ingredient mapping. Idempotent: an alias that
     * already exists is left untouched.
     * @param ingredientId The canonical ingredient the alias points to
     * @param alias The surface name to alias
     */
    addAlias(
        ingredientId: string,
        alias: string
    ): Promise<Result<void, DomainError>>;

    /**
     * Search for an ingredient using vector similarity
     * @param embedding Vector embedding (1536 dimensions)
     * @param threshold Similarity threshold (0.0-1.0), default 0.85
     * @returns Best matching ingredient with similarity score, or null if no match above threshold
     */
    vectorSearch(
        embedding: number[],
        threshold: number
    ): Promise<Result<VectorMatch | null, DomainError>>;

    /**
     * Create a new ingredient
     * @param ingredient Ingredient data to insert
     * @returns Created ingredient with generated ID
     */
    create(
        ingredient: IngredientInsertPayload
    ): Promise<Result<Ingredient, DomainError>>;
}
