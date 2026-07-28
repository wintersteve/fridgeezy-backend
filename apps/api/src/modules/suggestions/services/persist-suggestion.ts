import { failure, PersistenceError, Result } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { matchIngredients, IngredientMatch } from "./match-ingredients";
import { matchTags, TagInput, TagMatch } from "./match-tags";

export interface PersistSuggestionContext {
    /** The cuisine from the original request - will be marked as type: "cuisine" for auto-creation */
    cuisineTag?: string;
    /** The English name of the recipe for image generation and file naming */
    nameEn?: string;
}

export interface PersistedIngredient {
    id: string;
    name: string;
}

export interface PersistedTag {
    id: string;
    name: string;
}

export interface PersistedSuggestion {
    suggestionId: string;
    ingredients: PersistedIngredient[];
    tags: PersistedTag[];
}

/**
 * Persists a recipe suggestion with its ingredient and tag relations
 *
 * This orchestrator:
 * 1. Matches ingredients using 4-step fallback (name → alias → vector → create)
 * 2. Matches tags using 3-step fallback (canonical_id → vector → create for cuisines)
 * 3. Atomically persists suggestion with all relations
 *
 * @param suggestion The suggestion to persist
 * @param context Optional context with cuisine tag from the original request
 * @returns Result containing the created suggestion UUID and matched ingredient/tag IDs
 */
export async function persistSuggestion(
    suggestion: GenerateSuggestionResponseDto,
    context?: PersistSuggestionContext
): Promise<Result<PersistedSuggestion, PersistenceError>> {
    try {
        // Match ingredients
        const ingredientMatchesResult = await matchIngredients(
            suggestion.ingredients
        );
        if (!ingredientMatchesResult.success) {
            console.error(
                `Failed to match ingredients for "${suggestion.name}":`,
                ingredientMatchesResult.error
            );
            return ingredientMatchesResult;
        }

        const ingredientMatches = ingredientMatchesResult.value;

        // Build typed tag inputs - mark the cuisine tag from context as type: "cuisine"
        const tagInputs: TagInput[] = suggestion.tags.map((tag) => {
            // If this tag matches the cuisine from context, mark it as cuisine type
            if (
                context?.cuisineTag &&
                tag.toLowerCase() === context.cuisineTag.toLowerCase()
            ) {
                return { name: tag, type: "cuisine" as const };
            }
            return { name: tag };
        });

        // Match tags
        const tagMatchesResult = await matchTags(tagInputs);
        if (!tagMatchesResult.success) {
            console.error(
                `Failed to match tags for "${suggestion.name}":`,
                tagMatchesResult.error
            );
            return tagMatchesResult;
        }

        const tagMatches = tagMatchesResult.value;

        // Embed the suggestion name app-side (text-embedding-3-small) so Postgres
        // never calls OpenAI — passed through to persist_suggestion for storage.
        const nameEmbedding = await generateEmbedding(suggestion.name);

        // Persist suggestion with relations
        const suggestionsRepo = new SuggestionsRepository();
        const persistResult = await suggestionsRepo.persistWithRelations(
            {
                name: suggestion.name,
                description: suggestion.description,
                difficulty: suggestion.difficulty,
            },
            ingredientMatches.map((m) => m.ingredientId),
            tagMatches.map((m) => m.tagId),
            nameEmbedding,
            context?.nameEn
        );

        if (!persistResult.success) {
            console.error(
                `Failed to persist suggestion "${suggestion.name}":`,
                persistResult.error
            );
            return persistResult;
        }

        // Log successful persistence with match details
        const ingredientStats = {
            exact: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "exact_name"
            ).length,
            alias: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "alias"
            ).length,
            vector: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "vector"
            ).length,
            created: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "created"
            ).length,
        };

        const tagStats = {
            canonical_id: tagMatches.filter(
                (m: TagMatch) => m.matchType === "canonical_id"
            ).length,
            vector: tagMatches.filter(
                (m: TagMatch) => m.matchType === "vector"
            ).length,
            created: tagMatches.filter(
                (m: TagMatch) => m.matchType === "created"
            ).length,
        };

        console.log(
            `[Suggestions] Persisted: ${suggestion.name} (${persistResult.value})`,
            {
                ingredients: ingredientStats,
                tags: tagStats,
            }
        );

        return {
            success: true,
            value: {
                suggestionId: persistResult.value,
                ingredients: ingredientMatches.map((m) => ({
                    id: m.ingredientId,
                    name: m.originalName,
                })),
                tags: tagMatches.map((m) => ({
                    id: m.tagId,
                    name: m.originalName,
                })),
            },
        };
    } catch (error) {
        const errorMessage = `Failed to persist suggestion: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(errorMessage, error);
        return failure(new PersistenceError(errorMessage));
    }
}
