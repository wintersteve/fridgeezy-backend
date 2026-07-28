import { RecipeSuggestion } from "@fridgeezy/types";

import { nameContains } from "../validation";

/**
 * Recipe Suggestion Behaviors
 *
 * Stateless helper functions for RecipeSuggestion business logic.
 * These functions operate on RecipeSuggestion data and return new objects
 * (immutable pattern).
 */

/**
 * Check if a suggestion matches a search query
 *
 * Searches in both name and description (case-insensitive).
 *
 * @param suggestion The suggestion to search
 * @param query The search query
 * @returns true if the suggestion matches the query
 *
 * @example
 * ```typescript
 * const matches = matchesQuery(suggestion, 'chicken');
 * ```
 */
export function matchesQuery(
    suggestion: RecipeSuggestion,
    query: string
): boolean {
    const lowerQuery = query.toLowerCase();

    // Check name (using validation helper)
    if (nameContains(suggestion.name, query, false)) {
        return true;
    }

    // Check description
    if (
        suggestion.description &&
        suggestion.description.toLowerCase().includes(lowerQuery)
    ) {
        return true;
    }

    return false;
}

/**
 * Update a suggestion's description
 *
 * Returns a new suggestion object with updated description.
 *
 * @param suggestion The suggestion to update
 * @param description New description (can be null)
 * @returns A new RecipeSuggestion object with updated description
 */
export function updateDescription(
    suggestion: RecipeSuggestion,
    description: string | null
): RecipeSuggestion {
    return {
        ...suggestion,
        description,
    };
}

/**
 * Update a suggestion's difficulty level
 *
 * Returns a new suggestion object with updated difficulty.
 *
 * @param suggestion The suggestion to update
 * @param difficulty New difficulty level (can be null)
 * @returns A new RecipeSuggestion object with updated difficulty
 */
export function updateDifficulty(
    suggestion: RecipeSuggestion,
    difficulty: "easy" | "medium" | "hard" | null
): RecipeSuggestion {
    return {
        ...suggestion,
        difficulty,
    };
}

/**
 * Update a suggestion's name
 *
 * Returns a new suggestion object with updated name.
 * Note: This does NOT validate the name. Use validateSuggestionName first.
 *
 * @param suggestion The suggestion to update
 * @param name New name
 * @returns A new RecipeSuggestion object with updated name
 */
export function updateName(
    suggestion: RecipeSuggestion,
    name: string
): RecipeSuggestion {
    return {
        ...suggestion,
        name,
    };
}
