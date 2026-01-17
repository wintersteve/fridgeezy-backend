import { failure, PersistenceError, Result, success } from "@fridgeezy/domain";
import { TagsRepository } from "@fridgeezy/supabase";

import { inferTagType } from "./utils/infer-tag-type";

export interface TagMatch {
    originalName: string;
    tagId: string;
    tagType: string;
    matchType: "exact_name" | "created";
}

/**
 * Matches tag names using a simple 2-step strategy:
 * 1. Direct name match on tags table
 * 2. Create new tag if no match found (with inferred type)
 *
 * @param names Array of tag names to match
 * @returns Result containing array of tag matches
 */
export async function matchTags(
    names: string[]
): Promise<Result<TagMatch[], PersistenceError>> {
    const tagsRepo = new TagsRepository();
    const matches: TagMatch[] = [];
    let unmatched = [...names];

    try {
        // Step 1: Direct name match (batch)
        const nameMatchesResult = await tagsRepo.findByNames(unmatched);
        if (nameMatchesResult.success === false) {
            return nameMatchesResult;
        }

        const nameMatches = nameMatchesResult.value;
        nameMatches.forEach((tag, name) => {
            matches.push({
                originalName: name,
                tagId: tag.id,
                tagType: tag.type,
                matchType: "exact_name",
            });
        });

        unmatched = unmatched.filter((name) => !nameMatches.has(name));

        // Step 2: Create new tags
        for (const name of unmatched) {
            try {
                // Infer tag type from name
                const tagType = inferTagType(name);

                // Normalize to canonical ID
                const canonicalId = name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "");

                const createResult = await tagsRepo.create({
                    name,
                    canonical_id: canonicalId,
                    type: tagType,
                });

                if (createResult.success === false) {
                    console.error(
                        `Failed to create tag "${name}":`,
                        createResult.error
                    );
                    return failure(
                        new PersistenceError(
                            `Failed to create tag "${name}": ${createResult.error.message}`
                        )
                    );
                }

                matches.push({
                    originalName: name,
                    tagId: createResult.value.id,
                    tagType: createResult.value.type,
                    matchType: "created",
                });
            } catch (error) {
                console.error(`Failed to create tag "${name}":`, error);
                return failure(
                    new PersistenceError(
                        `Failed to create tag "${name}": ${error instanceof Error ? error.message : "Unknown error"}`
                    )
                );
            }
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
