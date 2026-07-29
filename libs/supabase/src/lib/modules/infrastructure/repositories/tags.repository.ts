import {
    ITagsRepository,
    TagVectorMatch,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Tag, TagInsertPayload } from "@fridgeezy/types";

import { supabase } from "../../client";

export class TagsRepository implements ITagsRepository {
    async findByNames(
        names: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("tags")
                .select("*")
                .in("name", names);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Tag>();
            if (data) {
                data.forEach((tag) => {
                    resultMap.set(tag.name, tag as Tag);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find tags by names: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findByCanonicalIds(
        canonicalIds: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("tags")
                .select("*")
                .in("canonical_id", canonicalIds);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Tag>();
            if (data) {
                data.forEach((tag) => {
                    resultMap.set(tag.canonical_id, tag as Tag);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find tags by canonical IDs: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async vectorSearch(
        embedding: number[],
        threshold: number
    ): Promise<Result<TagVectorMatch | null, DomainError>> {
        try {
            const tagTypes = [
                "dietary",
                "cuisine",
                "component",
                "course",
            ] as const;

            // Convert embedding array to the format Supabase expects (JSON string)
            const queryEmbedding = JSON.stringify(embedding);

            // Search all tag types in parallel
            const searchPromises = tagTypes.map((type) =>
                supabase.rpc("search_tags", {
                    query_embedding: queryEmbedding,
                    match_type: type,
                    match_threshold: threshold,
                    match_count: 1,
                })
            );

            const results = await Promise.all(searchPromises);

            // Check for errors and collect matches
            const matches: Array<{ id: string; similarity: number }> = [];
            for (const result of results) {
                if (result.error) {
                    return failure(new PersistenceError(result.error.message));
                }
                if (result.data && result.data.length > 0) {
                    matches.push({
                        id: result.data[0].id,
                        similarity: result.data[0].similarity,
                    });
                }
            }

            if (matches.length === 0) {
                return success(null);
            }

            // Find the best match (highest similarity)
            const bestMatch = matches.reduce((best, current) =>
                current.similarity > best.similarity ? current : best
            );

            // Fetch the full tag data
            const { data: tagData, error: tagError } = await supabase
                .from("tags")
                .select("*")
                .eq("id", bestMatch.id)
                .single();

            if (tagError) {
                return failure(new PersistenceError(tagError.message));
            }

            return success({
                tag: tagData as Tag,
                similarity: bestMatch.similarity,
            });
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to perform vector search: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async create(tag: TagInsertPayload): Promise<Result<Tag, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("tags")
                .insert(tag)
                .select()
                .single();

            if (error) {
                // Concurrent create race (duplicate canonical_id): reuse the row
                // that won rather than failing the whole suggestion.
                if (error.code === "23505" && tag.canonical_id) {
                    const existing = await supabase
                        .from("tags")
                        .select()
                        .eq("canonical_id", tag.canonical_id)
                        .single();
                    if (!existing.error && existing.data) {
                        return success(existing.data as Tag);
                    }
                }
                return failure(new PersistenceError(error.message));
            }

            return success(data as Tag);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to create tag: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }
}
