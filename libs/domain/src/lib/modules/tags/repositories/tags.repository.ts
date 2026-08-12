import { Tag, TagInsertPayload, TagType } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

export interface TagVectorMatch {
    tag: Tag;
    similarity: number;
}

export interface ITagsRepository {
    /**
     * Find tags by their exact names (batch operation)
     * @param names Array of tag names to search for
     * @returns Map of name → Tag for found matches
     */
    findByNames(
        names: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>>;

    /**
     * Find tags by their canonical IDs (batch operation)
     * @param canonicalIds Array of canonical IDs to search for
     * @returns Map of canonical_id → Tag for found matches
     */
    findByCanonicalIds(
        canonicalIds: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>>;

    /**
     * Resolve canonical IDs through the curated alternate spellings in
     * `tag_aliases`.
     *
     * Sits between {@link findByCanonicalIds} and {@link vectorSearch}: an alias
     * is an exact, hand-checked answer, so it should be preferred over a
     * similarity guess — and it is far cheaper, needing no embedding.
     * @param canonicalIds Array of canonical IDs to resolve
     * @param preferredType Which type to pick when one spelling aliases several
     * @returns Map of requested canonical_id → the aliased Tag
     */
    findByAliasCanonicalIds(
        canonicalIds: string[],
        preferredType?: TagType
    ): Promise<Result<Map<string, Tag>, DomainError>>;

    /**
     * Search for a tag using vector similarity across all tag types
     * @param embedding Precomputed query embedding (text-embedding-3-small, 1536-dim)
     * @param threshold Similarity threshold (0.0-1.0), default 0.75
     * @returns Best matching tag with similarity score, or null if no match above threshold
     */
    vectorSearch(
        embedding: number[],
        threshold: number
    ): Promise<Result<TagVectorMatch | null, DomainError>>;

    /**
     * Search for a tag using vector similarity within ONE tag type.
     *
     * Use when the type is already known and a hit of any other type would be
     * wrong — {@link vectorSearch} returns the best match across all four, so a
     * cuisine query can come back with a dietary tag that happened to embed
     * closer.
     * @param embedding Precomputed query embedding (text-embedding-3-small, 1536-dim)
     * @param type The only tag type to consider
     * @param threshold Similarity threshold (0.0-1.0)
     * @returns Best matching tag of that type, or null if none above threshold
     */
    vectorSearchByType(
        embedding: number[],
        type: TagType,
        threshold: number
    ): Promise<Result<TagVectorMatch | null, DomainError>>;

    /**
     * Create a new tag
     * @param tag Tag data to insert
     * @returns Created tag with generated ID
     */
    create(tag: TagInsertPayload): Promise<Result<Tag, DomainError>>;
}
