import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { TagsRepository } from "@fridgeezy/supabase";

export type TagType = "dietary" | "cuisine" | "component" | "course";

export interface TagInput {
    name: string;
    type?: TagType;
}

export interface TagMatch {
    originalName: string;
    tagId: string;
    tagType: string;
    matchType: "canonical_id" | "vector" | "created";
    confidence?: number;
}

/**
 * Matches tag names using a 2-step fallback strategy:
 * 1. Canonical ID lookup (direct match)
 * 2. Vector search using embeddings (similarity threshold: 0.75)
 * 3. For cuisine tags only: auto-create if not matched
 *
 * @param inputs Array of tag names (strings) or TagInput objects with optional type
 * @returns Result containing array of tag matches
 */
export async function matchTags(
    inputs: Array<string | TagInput>
): Promise<Result<TagMatch[], PersistenceError>> {
    const tagsRepo = new TagsRepository();
    const matches: TagMatch[] = [];

    // Helper function to convert name to canonical ID
    const toCanonicalId = (name: string): string =>
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

    // Normalize inputs to TagInput format
    const normalizedInputs: TagInput[] = inputs.map((input) =>
        typeof input === "string" ? { name: input } : input
    );

    // Create mapping from canonical ID to TagInput
    const canonicalToInput = new Map<string, TagInput>();
    normalizedInputs.forEach((input) => {
        canonicalToInput.set(toCanonicalId(input.name), input);
    });

    let unmatchedCanonicalIds = Array.from(canonicalToInput.keys());

    try {
        // Step 1: Canonical ID lookup (batch)
        const canonicalMatchesResult =
            await tagsRepo.findByCanonicalIds(unmatchedCanonicalIds);
        if (canonicalMatchesResult.success === false) {
            return canonicalMatchesResult;
        }

        const canonicalMatches = canonicalMatchesResult.value;
        canonicalMatches.forEach((tag, canonicalId) => {
            const input = canonicalToInput.get(canonicalId);
            if (input) {
                matches.push({
                    originalName: input.name,
                    tagId: tag.id,
                    tagType: tag.type,
                    matchType: "canonical_id",
                });
            }
        });

        unmatchedCanonicalIds = unmatchedCanonicalIds.filter(
            (id) => !canonicalMatches.has(id)
        );

        // Get TagInputs for still unmatched canonical IDs
        let unmatchedInputs = unmatchedCanonicalIds
            .map((id) => canonicalToInput.get(id))
            .filter((input): input is TagInput => input !== undefined);

        // Step 2: Vector search (embedding generated server-side)
        if (unmatchedInputs.length > 0) {
            const stillUnmatched: TagInput[] = [];

            for (const input of unmatchedInputs) {
                try {
                    // Embed the query app-side (text-embedding-3-small) and pass
                    // the vector to search_tags — no OpenAI call from Postgres.
                    const embedding = await generateEmbedding(input.name);
                    const vectorMatchResult = await tagsRepo.vectorSearch(
                        embedding,
                        0.75
                    );
                    if (vectorMatchResult.success === false) {
                        console.error(
                            `Vector search failed for "${input.name}":`,
                            vectorMatchResult.error
                        );
                        stillUnmatched.push(input);
                        continue;
                    }

                    const vectorMatch = vectorMatchResult.value;
                    if (vectorMatch) {
                        matches.push({
                            originalName: input.name,
                            tagId: vectorMatch.tag.id,
                            tagType: vectorMatch.tag.type,
                            matchType: "vector",
                            confidence: vectorMatch.similarity,
                        });
                    } else {
                        stillUnmatched.push(input);
                    }
                } catch (error) {
                    console.error(
                        `Vector search failed for "${input.name}":`,
                        error
                    );
                    stillUnmatched.push(input);
                }
            }

            unmatchedInputs = stillUnmatched;
        }

        // Step 3: Auto-create unmatched cuisine tags
        const cuisineInputs = unmatchedInputs.filter(
            (input) => input.type === "cuisine"
        );
        const nonCuisineInputs = unmatchedInputs.filter(
            (input) => input.type !== "cuisine"
        );

        for (const input of cuisineInputs) {
            try {
                // Generate embedding for the new tag
                const embedding = await generateEmbedding(input.name);

                const canonicalId = toCanonicalId(input.name);
                const createResult = await tagsRepo.create({
                    name: input.name.toLowerCase(),
                    canonical_id: canonicalId,
                    type: "cuisine",
                    embedding: JSON.stringify(embedding),
                });

                if (createResult.success === false) {
                    console.error(
                        `Failed to create cuisine tag "${input.name}":`,
                        createResult.error
                    );
                    nonCuisineInputs.push(input); // Track as unmatched
                    continue;
                }

                const newTag = createResult.value;
                console.log(
                    `[Tags] Created new cuisine tag: ${newTag.name} (${newTag.id})`
                );

                matches.push({
                    originalName: input.name,
                    tagId: newTag.id,
                    tagType: "cuisine",
                    matchType: "created",
                });
            } catch (error) {
                console.error(
                    `Failed to create cuisine tag "${input.name}":`,
                    error
                );
                nonCuisineInputs.push(input); // Track as unmatched
            }
        }

        // Log any tags that couldn't be matched (excluding created cuisine tags)
        if (nonCuisineInputs.length > 0) {
            console.warn(
                `Could not match tags: ${nonCuisineInputs.map((i) => i.name).join(", ")}`
            );
        }

        return success(matches);
    } catch (error) {
        return failure(
            new PersistenceError(
                `Failed to match tags: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
    }
}
