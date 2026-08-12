import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { TagsRepository } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

export type TagType =
    | "dietary"
    | "cuisine"
    | "component"
    | "course"
    | "dish_form";

export interface TagInput {
    name: string;
    type?: TagType;
}

export interface TagMatch {
    originalName: string;
    tagId: string;
    tagType: string;
    matchType: "canonical_id" | "alias" | "vector" | "created";
    confidence?: number;
}

/**
 * Where a newly invented cuisine belongs in the tree.
 *
 * Returns the id of the nearest sensible ancestor, or null when nothing is
 * close enough — a null parent is still better than a wrong one, and it is
 * logged so the tag can be placed by hand.
 */
const CUISINE_PARENT_THRESHOLD = 0.45;

async function resolveCuisineParent(
    tagsRepo: TagsRepository,
    embedding: number[],
    name: string
): Promise<string | null> {
    try {
        const nearest = await tagsRepo.vectorSearchByType(
            embedding,
            "cuisine",
            CUISINE_PARENT_THRESHOLD
        );

        if (nearest.success === false || !nearest.value) {
            console.warn(
                `[Tags] No cuisine near "${name}" — creating it outside the hierarchy, so only an exact selection will find it.`
            );
            return null;
        }

        const { tag } = nearest.value;

        // A continental root adopts the tag directly, so it lands one level
        // beneath. Anything deeper hands over its own parent instead, making the
        // new tag a SIBLING of the match — "tex-mex" belongs beside "mexican",
        // not under it.
        //
        // When the nearest hit is itself a region this sits one level higher
        // than ideal (a specific cuisine ends up beside "east asian" rather than
        // under it). Left that way on purpose: telling a region from a leaf
        // needs a children lookup, and the placement only has to keep the tag
        // inside the tree and reachable from the continental filters.
        const parentId = tag.parent_id ?? tag.id;

        console.log(
            `[Tags] Placing new cuisine "${name}" under the parent of "${tag.name}" (similarity ${nearest.value.similarity.toFixed(2)})`
        );

        return parentId;
    } catch (error) {
        console.error(`[Tags] Failed to place cuisine "${name}":`, error);
        return null;
    }
}

/**
 * Matches tag names, cheapest and most certain first:
 * 1. Canonical ID lookup (direct match)
 * 1b. `tag_aliases` — curated alternate spellings, still exact, still one query
 * 2. Vector search using embeddings (similarity threshold: 0.75)
 * 3. For cuisine tags only: auto-create if not matched
 *
 * The ordering is the design. Steps 1 and 1b are exact and free; step 2 guesses
 * and costs an embedding; step 3 permanently widens the vocabulary. Anything
 * that can be answered earlier must be, because step 3 has no undo.
 *
 * @param inputs Array of tag names (strings) or TagInput objects with optional type
 * @returns Result containing array of tag matches
 */
export async function matchTags(
    inputs: Array<string | TagInput>
): Promise<Result<TagMatch[], PersistenceError>> {
    const tagsRepo = new TagsRepository();
    const matches: TagMatch[] = [];

    // Tag identity. Same rule as canonicalizeName; the `?? ""` keeps this
    // function's original contract (empty string, not null, for a name that
    // normalizes to nothing) so callers below are unaffected.
    const toCanonicalId = (name: string): string => canonicalizeName(name) ?? "";

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

        // Step 1b: curated alternate spellings. Exact, hand-checked, and one
        // indexed query — so it belongs ahead of the vector search rather than
        // after it, on the same reasoning that puts the canonical lookup first.
        //
        // `matchTags` did not consult `tag_aliases` at all until 2026-08-12,
        // which mattered most for cuisine: it is the one type auto-CREATED on a
        // miss (step 3), so "szechuan" did not fall back to `sichuan`, it minted
        // a second tag for the same cuisine and split that cuisine's dishes
        // across both. The SQL side has always had this fallback —
        // `persist_recipe` checks `tag_aliases` when a canonical lookup misses —
        // so this closes a divergence between the two tag pipelines rather than
        // inventing a new rule.
        if (unmatchedCanonicalIds.length > 0) {
            const aliasMatchesResult = await tagsRepo.findByAliasCanonicalIds(
                unmatchedCanonicalIds
            );

            if (aliasMatchesResult.success === false) {
                // An alias miss is a degraded match, not a failed one — the
                // vector search below can still resolve these.
                console.error(
                    "[Tags] Alias lookup failed, falling through to vector search:",
                    aliasMatchesResult.error
                );
            } else {
                aliasMatchesResult.value.forEach((tag, canonicalId) => {
                    const input = canonicalToInput.get(canonicalId);
                    if (!input) return;

                    console.log(
                        `[Tags] Alias "${input.name}" -> ${tag.name} (${tag.type})`
                    );

                    matches.push({
                        originalName: input.name,
                        tagId: tag.id,
                        tagType: tag.type,
                        matchType: "alias",
                    });
                });

                unmatchedCanonicalIds = unmatchedCanonicalIds.filter(
                    (id) => !aliasMatchesResult.value.has(id)
                );
            }
        }

        // Get TagInputs for still unmatched canonical IDs
        let unmatchedInputs = unmatchedCanonicalIds
            .map((id) => canonicalToInput.get(id))
            .filter((input): input is TagInput => input !== undefined);

        // Step 2: Vector search (PARALLEL, read-only). Embed each remaining tag
        // app-side (text-embedding-3-small) and search — independent reads, so
        // run them concurrently instead of one tag at a time.
        if (unmatchedInputs.length > 0) {
            const searched = await Promise.all(
                unmatchedInputs.map(async (input) => {
                    try {
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
                            return { input, match: null };
                        }
                        return { input, match: vectorMatchResult.value };
                    } catch (error) {
                        console.error(
                            `Vector search failed for "${input.name}":`,
                            error
                        );
                        return { input, match: null };
                    }
                })
            );

            const stillUnmatched: TagInput[] = [];
            for (const { input, match } of searched) {
                if (match) {
                    matches.push({
                        originalName: input.name,
                        tagId: match.tag.id,
                        tagType: match.tag.type,
                        matchType: "vector",
                        confidence: match.similarity,
                    });
                } else {
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

                // Place the new tag in the cuisine tree rather than beside it.
                //
                // Cuisine tags form a 3-level hierarchy, and since
                // 20260803000002 a filter on "asian" matches everything BELOW
                // it. A tag created with a null parent sits outside that tree:
                // reachable only by selecting its own name, invisible to every
                // regional and continental filter, and permanently so. Every
                // cuisine invented at runtime used to land there.
                //
                // The nearest existing cuisine (searched at a threshold well
                // below the 0.75 that just failed — this only has to be in the
                // right part of the world, not a match) supplies the parent: its
                // own parent when it is a leaf, or itself when it is already a
                // root or region.
                const parentId = await resolveCuisineParent(
                    tagsRepo,
                    embedding,
                    input.name
                );

                const canonicalId = toCanonicalId(input.name);
                const createResult = await tagsRepo.create({
                    name: input.name.toLowerCase(),
                    canonical_id: canonicalId,
                    type: "cuisine",
                    parent_id: parentId,
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
