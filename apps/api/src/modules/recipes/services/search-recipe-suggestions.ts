import { randomUUID } from "node:crypto";

import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import { generateSuggestionsStream } from "../../suggestions/services/generate-suggestions-stream";
import { streamSingleSuggestion } from "../../suggestions/services/stream-single-suggestion";

import { fetchRecipeSummary } from "./fetch-recipe-summary";
import { searchRecipes } from "./search-recipes";

export interface RecipeSuggestionInput {
    query: string;
    matchThreshold?: number;
    maxResults?: number;
    /** Dietary tags any generated suggestion must satisfy. */
    dietaryRestrictions?: string[];
    /** Ingredients to never suggest (allergies/dislikes). */
    blacklist?: string[];
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
    /**
     * Present only for LLM-generated suggestions: correlates this (enriched)
     * item with the partial that was emitted via `onPartialSuggestion` before
     * persistence, so a streaming caller can upgrade the card in place.
     */
    tempId?: string;
}

/**
 * A generated suggestion streaming in field-by-field, before persistence — no
 * ids, raw string ingredients/tags. Emitted repeatedly (cumulatively) via
 * `onPartialSuggestion` as each field lands, so a caller can reveal the card
 * one field at a time. `name` is always present (it streams first); everything
 * else fills in over subsequent frames. The final enriched item shares `tempId`.
 */
export interface PartialRecipeSuggestion {
    tempId: string;
    source: "new_suggestion";
    name: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard";
    ingredients?: string[];
    tags?: string[];
}

export interface SearchRecipeSuggestionsOptions {
    /**
     * Present for streaming callers (chat). When set, stage 3 generates a SINGLE
     * suggestion and streams its fields out through this callback as they land;
     * when absent, stage 3 falls back to the multi-suggestion JSONL generator.
     */
    onPartialSuggestion?: (partial: PartialRecipeSuggestion) => void;
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
    input: RecipeSuggestionInput,
    options: SearchRecipeSuggestionsOptions = {}
): Promise<RecipeSuggestionResult> {
    const {
        query,
        matchThreshold = 0.75,
        maxResults = 5,
        dietaryRestrictions,
        blacklist,
    } = input;
    const { onPartialSuggestion } = options;

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

    // Fetch each hit's summary in parallel (independent reads) rather than one
    // round-trip per result, then assemble in the original ranked order.
    const summaries = await Promise.all(
        vectorResults.map((result) => fetchRecipeSummary(result.id))
    );

    vectorResults.forEach((result, i) => {
        const recipeSummary = summaries[i];

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
    });

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
            if (onPartialSuggestion) {
                // Streaming caller (chat): generate ONE suggestion and stream
                // its fields out — title first, then description, etc. — sharing
                // a tempId so the enriched item below upgrades the same card.
                const tempId = randomUUID();

                const enriched = await streamSingleSuggestion(
                    { ingredients: [query], dietaryRestrictions, blacklist },
                    {
                        onField: (fields) => {
                            // `name` streams first; hold the frame until it lands
                            // so the card never renders without a title.
                            if (!fields.name) return;
                            onPartialSuggestion({
                                tempId,
                                source: "new_suggestion",
                                name: fields.name,
                                description: fields.description,
                                difficulty: fields.difficulty,
                                ingredients: fields.ingredients,
                                tags: fields.tags,
                            });
                        },
                    }
                );

                if (enriched) {
                    suggestions.push({
                        id: enriched.id,
                        name: enriched.name,
                        description: enriched.description,
                        difficulty: enriched.difficulty,
                        source: "new_suggestion",
                        tempId,
                        ingredients: enriched.ingredients.map((ing) => ({
                            id: ing.id,
                            name: ing.name,
                        })),
                        tags: enriched.tags.map((tag) => ({
                            id: tag.id,
                            name: tag.name,
                        })),
                    });
                    metadata.newSuggestionsCreated++;
                }
            } else {
                // Non-streaming caller: keep the multi-suggestion JSONL generator.
                let generatedCount = 0;
                const stream = generateSuggestionsStream({
                    ingredients: [query],
                    dietaryRestrictions,
                    blacklist,
                });

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
