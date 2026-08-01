import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";

import { DomainError, Result } from "../../shared";

/**
 * Repository interface for Recipe persistence.
 *
 * Defines the contract that infrastructure implementations must fulfill.
 * This interface lives in the domain layer (Dependency Inversion Principle).
 *
 * @example
 * ```typescript
 * class SupabaseRecipesRepository implements IRecipesRepository {
 *   async persist(recipe: RecipeResponse, imageUrl: string): Promise<Result<string, DomainError>> {
 *     // Implementation using Supabase RPC
 *   }
 * }
 * ```
 */
export interface IRecipesRepository {
    /**
     * Persist a complete recipe with all related entities.
     *
     * Creates:
     * - Recipe record in recipes table
     * - Ingredient records and recipe_ingredients junction
     * - Instruction records in recipe_instructions
     * - Tag records and recipe_tags junction
     *
     * All operations are atomic (transaction-based).
     *
     * @param recipe The recipe data to persist
     * @param imageUrl The URL of the generated recipe image
     * @returns Result containing the recipe UUID or error
     */
    persist(
        recipe: GenerateRecipeResponseDto,
        imageUrl: string
    ): Promise<Result<string, DomainError>>;
}
