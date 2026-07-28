import { Tag, TagInsertPayload } from "@fridgeezy/types";

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
     * Create a new tag
     * @param tag Tag data to insert
     * @returns Created tag with generated ID
     */
    create(tag: TagInsertPayload): Promise<Result<Tag, DomainError>>;
}
