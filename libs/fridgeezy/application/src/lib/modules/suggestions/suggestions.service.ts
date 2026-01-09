import type { ISuggestionsRepository } from "@fridgeezy/domain";
import {
    Result,
    success,
    failure,
    DomainError,
    ValidationError,
    NotFoundError,
    RecipeSuggestion,
    SuggestionName,
    Difficulty,
    DifficultyLevel,
} from "@fridgeezy/domain";
import { inject, injectable } from "tsyringe";

/**
 * DTO for creating a suggestion
 */
export interface CreateSuggestionDto {
    name: string;
    description?: string | null;

    difficulty?: DifficultyLevel;
}

/**
 * DTO for updating a suggestion
 */
export interface UpdateSuggestionDto {
    name?: string;
    description?: string | null;
    difficulty?: DifficultyLevel | null;
}

/**
 * Application service for RecipeSuggestion business logic.
 *
 * Orchestrates domain objects and repositories to implement use cases.
 * This is the primary entry point for suggestion-related operations.
 *
 * @example
 * ```typescript
 * const service = new SuggestionsService(repository);
 *
 * const result = await service.createSuggestion({
 *   name: 'Chicken Curry',
 *   description: 'A delicious curry dish',
 *   difficulty: 'medium'
 * });
 *
 * if (result.success) {
 *   console.log('Created:', result.value);
 * }
 * ```
 */
@injectable()
export class SuggestionsService {
    constructor(
        @inject("ISuggestionsRepository")
        private readonly repository: ISuggestionsRepository
    ) {}

    /**
     * Create a new recipe suggestion
     *
     * Validates input, creates domain entity, and persists it.
     *
     * @param dto Input data for creating a suggestion
     * @returns Result containing the created suggestion or an error
     */
    async createSuggestion(
        dto: CreateSuggestionDto
    ): Promise<Result<RecipeSuggestion, DomainError>> {
        // Validate and create name value object
        const nameResult = SuggestionName.create(dto.name);
        if (!nameResult.success) {
            return failure(nameResult.error);
        }

        // Validate and create difficulty value object (if provided)
        let difficulty: Difficulty | null = null;
        if (dto.difficulty) {
            const difficultyResult = Difficulty.create(dto.difficulty);
            if (!difficultyResult.success) {
                return failure(difficultyResult.error);
            }
            difficulty = difficultyResult.value;
        }

        // Check for duplicate name
        const existingResult = await this.repository.findByName(dto.name);
        if (!existingResult.success) {
            return failure(existingResult.error);
        }
        if (existingResult.value) {
            return failure(
                new ValidationError(
                    `A suggestion with the name "${dto.name}" already exists`,
                    "name"
                )
            );
        }

        // Create domain entity
        const suggestion = RecipeSuggestion.create(
            nameResult.value,
            dto.description ?? null,
            difficulty
        );

        // Persist
        return await this.repository.create(suggestion);
    }

    /**
     * Get a suggestion by its ID
     *
     * @param id The suggestion ID
     * @returns Result containing the suggestion or null if not found
     */
    async getSuggestionById(
        id: string
    ): Promise<Result<RecipeSuggestion | null, DomainError>> {
        return await this.repository.findById(id);
    }

    /**
     * Get a suggestion by its name
     *
     * @param name The suggestion name
     * @returns Result containing the suggestion or null if not found
     */
    async getSuggestionByName(
        name: string
    ): Promise<Result<RecipeSuggestion | null, DomainError>> {
        return await this.repository.findByName(name);
    }

    /**
     * Get all suggestions
     *
     * @returns Result containing array of all suggestions
     */
    async getAllSuggestions(): Promise<
        Result<RecipeSuggestion[], DomainError>
    > {
        return await this.repository.findAll();
    }

    /**
     * Get suggestions that haven't been promoted to recipes yet
     *
     * @returns Result containing array of unpromoted suggestions
     */
    async getUnpromotedSuggestions(): Promise<
        Result<RecipeSuggestion[], DomainError>
    > {
        return await this.repository.findUnpromoted();
    }

    /**
     * Update an existing suggestion
     *
     * @param id The suggestion ID
     * @param dto The fields to update
     * @returns Result containing the updated suggestion
     */
    async updateSuggestion(
        id: string,
        dto: UpdateSuggestionDto
    ): Promise<Result<RecipeSuggestion, DomainError>> {
        // Fetch existing suggestion
        const existingResult = await this.repository.findById(id);
        if (!existingResult.success) {
            return failure(existingResult.error);
        }

        if (!existingResult.value) {
            return failure(new NotFoundError("RecipeSuggestion", id));
        }

        const suggestion = existingResult.value;

        // Apply updates
        if (dto.name !== undefined) {
            const nameResult = SuggestionName.create(dto.name);
            if (!nameResult.success) {
                return failure(nameResult.error);
            }

            // Check for duplicate name (excluding current suggestion)
            const duplicateResult = await this.repository.findByName(dto.name);
            if (!duplicateResult.success) {
                return failure(duplicateResult.error);
            }
            if (
                duplicateResult.value &&
                !duplicateResult.value.equals(suggestion)
            ) {
                return failure(
                    new ValidationError(
                        `A suggestion with the name "${dto.name}" already exists`,
                        "name"
                    )
                );
            }

            suggestion.updateName(nameResult.value);
        }

        if (dto.description !== undefined) {
            suggestion.updateDescription(dto.description);
        }

        if (dto.difficulty !== undefined) {
            if (dto.difficulty === null) {
                suggestion.updateDifficulty(null);
            } else {
                const difficultyResult = Difficulty.create(dto.difficulty);
                if (!difficultyResult.success) {
                    return failure(difficultyResult.error);
                }
                suggestion.updateDifficulty(difficultyResult.value);
            }
        }

        // Persist updates
        return await this.repository.update(suggestion);
    }

    /**
     * Delete a suggestion
     *
     * @param id The suggestion ID
     * @returns Result indicating success or failure
     */
    async deleteSuggestion(id: string): Promise<Result<void, DomainError>> {
        // Verify suggestion exists
        const existingResult = await this.repository.findById(id);
        if (!existingResult.success) {
            return failure(existingResult.error);
        }

        if (!existingResult.value) {
            return failure(new NotFoundError("RecipeSuggestion", id));
        }

        return await this.repository.delete(id);
    }

    /**
     * Promote a suggestion to a recipe
     *
     * This updates the suggestion to mark it as promoted.
     *
     * @param suggestionId The suggestion ID
     * @param recipeId The recipe ID it's being promoted to
     * @returns Result containing the updated suggestion
     */
    async promoteSuggestion(
        suggestionId: string,
        recipeId: string
    ): Promise<Result<RecipeSuggestion, DomainError>> {
        // Fetch suggestion
        const result = await this.repository.findById(suggestionId);
        if (!result.success) {
            return failure(result.error);
        }

        if (!result.value) {
            return failure(new NotFoundError("RecipeSuggestion", suggestionId));
        }

        const suggestion = result.value;

        // Apply business rule (throws if already promoted)
        try {
            suggestion.promote(recipeId);
        } catch (error) {
            if (error instanceof DomainError) {
                return failure(error);
            }
            throw error;
        }

        // Persist
        return await this.repository.update(suggestion);
    }

    /**
     * Search suggestions by query
     *
     * Searches in name and description fields.
     *
     * @param query The search query
     * @returns Result containing matching suggestions
     */
    async searchSuggestions(
        query: string
    ): Promise<Result<RecipeSuggestion[], DomainError>> {
        const allResult = await this.repository.findAll();
        if (!allResult.success) {
            return failure(allResult.error);
        }

        const matches = allResult.value.filter((suggestion) =>
            suggestion.matchesQuery(query)
        );

        return success(matches);
    }
}
