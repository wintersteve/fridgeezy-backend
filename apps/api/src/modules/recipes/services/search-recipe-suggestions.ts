import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import { generateSuggestionsStream } from "../../suggestions/services/generate-suggestions-stream";

import { fetchRecipeSummary } from "./fetch-recipe-summary";
import { searchRecipes } from "./search-recipes";

export interface RecipeSuggestionInput {
    query: string;
    matchThreshold?: number;
    maxResults?: number;
}

export interface RecipeSuggestionItem {
    id: string;
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    source: "existing_recipe" | "suggestion" | "new_suggestion";
    matchScore?: number;
    ingredients: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string }>;
}

export interface SearchMetadata {
    vectorSearchHits: number;
    canonicalSearchHits: number;
    newSuggestionsCreated: number;
}

export interface RecipeSuggestionResult {
    suggestions: RecipeSuggestionItem[];
    searchMetadata: SearchMetadata;
}

/**
 * Search for recipe suggestions using a 3-stage approach:
 * 1. Vector search on recipes table
 * 2. Canonical search on suggestions table
 * 3. Create new suggestions if nothing found
 *
 * @param input Search parameters
 * @returns Suggestions with metadata about search results
 */
export async function searchRecipeSuggestions(
    input: RecipeSuggestionInput
): Promise<RecipeSuggestionResult> {
    const { query, matchThreshold = 0.75, maxResults = 5 } = input;

    const suggestions: RecipeSuggestionItem[] = [];
    const metadata: SearchMetadata = {
        vectorSearchHits: 0,
        canonicalSearchHits: 0,
        newSuggestionsCreated: 0,
    };

    // Stage 1: Vector search on recipes
    const vectorResults = await searchRecipes(
        query,
        matchThreshold,
        maxResults
    );

    for (const result of vectorResults) {
        const recipeSummary = await fetchRecipeSummary(result.id);

        if (recipeSummary) {
            suggestions.push({
                id: recipeSummary.id,
                name: recipeSummary.name,
                description: recipeSummary.description,
                difficulty: recipeSummary.difficulty,
                source: "existing_recipe",
                matchScore: result.score,
                ingredients: recipeSummary.ingredients.map((ing) => ({
                    id: ing.id,
                    name: ing.name,
                })),
                tags: recipeSummary.tags.map((tag) => ({
                    id: tag.id,
                    name: tag.name,
                })),
            });
            metadata.vectorSearchHits++;
        }
    }

    // If we have enough results from vector search, return early
    if (suggestions.length >= maxResults) {
        return {
            suggestions: suggestions.slice(0, maxResults),
            searchMetadata: metadata,
        };
    }

    // Stage 2: Canonical search on suggestions table
    const existingSuggestion = await findSuggestionByName(query);

    if (existingSuggestion) {
        suggestions.push({
            id: existingSuggestion.id,
            name: existingSuggestion.name,
            description: existingSuggestion.description,
            difficulty: existingSuggestion.difficulty,
            source: "suggestion",
            ingredients: existingSuggestion.ingredients.map((ing) => ({
                id: ing.id,
                name: ing.name,
            })),
            tags: existingSuggestion.tags.map((tag) => ({
                id: tag.id,
                name: tag.name,
            })),
        });
        metadata.canonicalSearchHits++;
    }

    // If we have enough results, return
    if (suggestions.length >= maxResults) {
        return {
            suggestions: suggestions.slice(0, maxResults),
            searchMetadata: metadata,
        };
    }

    // Stage 3: Generate new suggestions using LLM if nothing found
    if (suggestions.length === 0) {
        console.log(
            `[SearchRecipeSuggestions] No results found for "${query}", generating suggestions with LLM`
        );

        try {
            // Use the suggestion generation stream to create enriched suggestions
            // The query is treated as a general recipe concept/ingredient
            const stream = generateSuggestionsStream({
                ingredients: [query],
            });

            // Consume the stream and collect up to maxResults suggestions
            let generatedCount = 0;
            for await (const suggestion of stream) {
                if (generatedCount >= maxResults) {
                    break;
                }

                suggestions.push({
                    id: suggestion.id,
                    name: suggestion.name,
                    description: suggestion.description,
                    difficulty: suggestion.difficulty,
                    source: "new_suggestion",
                    ingredients: suggestion.ingredients.map((ing) => ({
                        id: ing.id,
                        name: ing.name,
                    })),
                    tags: suggestion.tags.map((tag) => ({
                        id: tag.id,
                        name: tag.name,
                    })),
                });
                metadata.newSuggestionsCreated++;
                generatedCount++;
            }
        } catch (error) {
            console.error(
                `[SearchRecipeSuggestions] Failed to generate suggestions for "${query}":`,
                error
            );
        }
    }

    return {
        suggestions: suggestions.slice(0, maxResults),
        searchMetadata: metadata,
    };
}
