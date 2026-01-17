import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { IngredientsRepository } from "@fridgeezy/supabase";

export interface IngredientMatch {
    originalName: string;
    ingredientId: string;
    matchType: "exact_name" | "alias" | "vector" | "created";
    confidence?: number;
}

/**
 * Matches ingredient names using a 4-step fallback strategy:
 * 1. Direct name match on ingredients table
 * 2. Alias match on ingredient_aliases table
 * 3. Vector search using embeddings (similarity threshold: 0.85)
 * 4. Create new ingredient if no match found
 *
 * @param names Array of ingredient names to match
 * @returns Result containing array of ingredient matches
 */
export async function matchIngredients(
    names: string[]
): Promise<Result<IngredientMatch[], PersistenceError>> {
    const ingredientsRepo = new IngredientsRepository();
    const matches: IngredientMatch[] = [];

    // Helper function to convert name to canonical ID
    const toCanonicalId = (name: string): string =>
        name.toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

    // Create mapping from canonical ID to original name
    const canonicalToOriginal = new Map<string, string>();
    names.forEach(name => {
        canonicalToOriginal.set(toCanonicalId(name), name);
    });

    let unmatchedCanonicalIds = Array.from(canonicalToOriginal.keys());

    try {
        // Step 1: Direct name match (batch)
        const nameMatchesResult =
            await ingredientsRepo.findByCanonicalIds(unmatchedCanonicalIds);
        if (nameMatchesResult.success === false) {
            return nameMatchesResult;
        }

        const nameMatches = nameMatchesResult.value;
        nameMatches.forEach((ingredient, canonicalId) => {
            const originalName = canonicalToOriginal.get(canonicalId);
            if (originalName) {
                matches.push({
                    originalName,
                    ingredientId: ingredient.id,
                    matchType: "exact_name",
                });
            }
        });

        unmatchedCanonicalIds = unmatchedCanonicalIds.filter((id) => !nameMatches.has(id));

        // Get original names for unmatched canonical IDs
        let unmatchedOriginalNames = unmatchedCanonicalIds
            .map(id => canonicalToOriginal.get(id))
            .filter((name): name is string => name !== undefined);

        // Step 2: Alias match (batch)
        if (unmatchedOriginalNames.length > 0) {
            const aliasMatchesResult =
                await ingredientsRepo.findByAliases(unmatchedOriginalNames);
            if (aliasMatchesResult.success === false) {
                return aliasMatchesResult;
            }

            const aliasMatches = aliasMatchesResult.value;
            aliasMatches.forEach((ingredientId, alias) => {
                matches.push({
                    originalName: alias,
                    ingredientId,
                    matchType: "alias",
                });
            });

            unmatchedOriginalNames = unmatchedOriginalNames.filter((name) => !aliasMatches.has(name));
        }

        // Step 3: Vector search (one at a time with embeddings)
        if (unmatchedOriginalNames.length > 0) {
            const stillUnmatched: string[] = [];

            for (const name of unmatchedOriginalNames) {
                try {
                    // Generate embedding for this ingredient name
                    const embedding = await generateEmbedding(name);

                    // Search for similar ingredients
                    const vectorMatchResult =
                        await ingredientsRepo.vectorSearch(embedding, 0.85);
                    if (vectorMatchResult.success === false) {
                        console.error(
                            `Vector search failed for "${name}":`,
                            vectorMatchResult.error
                        );
                        stillUnmatched.push(name);
                        continue;
                    }

                    const vectorMatch = vectorMatchResult.value;
                    if (vectorMatch) {
                        matches.push({
                            originalName: name,
                            ingredientId: vectorMatch.ingredient.id,
                            matchType: "vector",
                            confidence: vectorMatch.similarity,
                        });
                    } else {
                        stillUnmatched.push(name);
                    }
                } catch (error) {
                    console.error(
                        `Failed to generate embedding for "${name}":`,
                        error
                    );
                    stillUnmatched.push(name);
                }
            }

            unmatchedOriginalNames = stillUnmatched;
        }

        // Step 4: Create new ingredients
        for (const name of unmatchedOriginalNames) {
            try {
                // Normalize to canonical ID
                const canonicalId = toCanonicalId(name);

                // Generate embedding for the new ingredient
                let embedding: number[] | null = null;
                try {
                    embedding = await generateEmbedding(name);
                } catch (error) {
                    console.error(
                        `Failed to generate embedding for new ingredient "${name}":`,
                        error
                    );
                    // Continue without embedding
                }

                const createResult = await ingredientsRepo.create({
                    name,
                    canonical_id: canonicalId,
                    category_id: null, // No default category per user requirement
                    embedding: embedding ? JSON.stringify(embedding) : null,
                });

                if (createResult.success === false) {
                    console.error(
                        `Failed to create ingredient "${name}":`,
                        createResult.error
                    );
                    return failure(
                        new PersistenceError(
                            `Failed to create ingredient "${name}": ${createResult.error.message}`
                        )
                    );
                }

                matches.push({
                    originalName: name,
                    ingredientId: createResult.value.id,
                    matchType: "created",
                });
            } catch (error) {
                console.error(`Failed to create ingredient "${name}":`, error);
                return failure(
                    new PersistenceError(
                        `Failed to create ingredient "${name}": ${error instanceof Error ? error.message : "Unknown error"}`
                    )
                );
            }
        }

        return success(matches);
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to match ingredients: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
