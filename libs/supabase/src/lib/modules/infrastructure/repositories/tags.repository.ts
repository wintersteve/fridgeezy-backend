import {
    ITagsRepository,
    TagVectorMatch,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Tag, TagInsertPayload, TagType } from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

export class TagsRepository implements ITagsRepository {
    async findByNames(
        names: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>> {
        try {
            const { data, error } = await supabaseAdmin
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
            const { data, error } = await supabaseAdmin
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

    /**
     * Resolve canonical ids through `tag_aliases` — the alternate spellings
     * curated for a tag, keyed by the same canonical rule as the tag itself.
     *
     * Returns a map from the REQUESTED canonical id to the tag it aliases, so
     * callers can treat a hit here exactly like a hit from
     * {@link findByCanonicalIds}. Ids that are not aliases are simply absent.
     *
     * `preferredType` breaks the one ambiguity in the table: the unique key is
     * `(alias, type)`, so the same spelling may legitimately alias one tag as a
     * cuisine and another as a dish_form. Without it this would return whichever
     * row the planner happened to emit first.
     */
    async findByAliasCanonicalIds(
        canonicalIds: string[],
        preferredType?: TagType
    ): Promise<Result<Map<string, Tag>, DomainError>> {
        if (canonicalIds.length === 0) {
            return success(new Map());
        }

        try {
            const { data, error } = await supabaseAdmin
                .from("tag_aliases")
                .select("canonical_id, type, tag:tags!tag_aliases_tag_id_fkey(*)")
                .in("canonical_id", canonicalIds);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Tag>();

            for (const row of data ?? []) {
                const tag = row.tag as Tag | null;
                if (!tag) continue;

                // First writer wins, except that a row of the preferred type
                // always displaces one that is not.
                const existing = resultMap.get(row.canonical_id);
                if (existing && (!preferredType || row.type !== preferredType)) {
                    continue;
                }

                resultMap.set(row.canonical_id, tag);
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find tags by alias canonical IDs: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    /**
     * Nearest tag of ONE type, rather than the best across all four.
     *
     * `vectorSearch` deliberately searches every type and returns the single
     * best hit, which is right when resolving a tag name of unknown type. It is
     * wrong when the type is already known and only that type will do — placing
     * a new cuisine under a parent must not match a dietary or course tag just
     * because it embedded closer.
     */
    async vectorSearchByType(
        embedding: number[],
        type: TagType,
        threshold: number
    ): Promise<Result<TagVectorMatch | null, DomainError>> {
        try {
            const { data, error } = await supabaseAdmin.rpc("search_tags", {
                query_embedding: JSON.stringify(embedding),
                match_type: type,
                match_threshold: threshold,
                match_count: 1,
            });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data || data.length === 0) {
                return success(null);
            }

            const { data: tagData, error: tagError } = await supabaseAdmin
                .from("tags")
                .select("*")
                .eq("id", data[0].id)
                .single();

            if (tagError) {
                return failure(new PersistenceError(tagError.message));
            }

            return success({
                tag: tagData as Tag,
                similarity: data[0].similarity,
            });
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to search ${type} tags: ${error instanceof Error ? error.message : String(error)}`
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
                supabaseAdmin.rpc("search_tags", {
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
            const { data: tagData, error: tagError } = await supabaseAdmin
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
            const { data, error } = await supabaseAdmin
                .from("tags")
                .insert(tag)
                .select()
                .single();

            if (error) {
                // Concurrent create race (duplicate canonical_id): reuse the row
                // that won rather than failing the whole suggestion.
                if (error.code === "23505" && tag.canonical_id) {
                    const existing = await supabaseAdmin
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
