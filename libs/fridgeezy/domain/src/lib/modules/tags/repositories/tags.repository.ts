import { Tag, TagInsertPayload } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

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
     * Create a new tag
     * @param tag Tag data to insert
     * @returns Created tag with generated ID
     */
    create(tag: TagInsertPayload): Promise<Result<Tag, DomainError>>;
}
