import { Category } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

export interface CategoryVectorMatch {
    category: Category;
    similarity: number;
}

export interface ICategoriesRepository {
    /**
     * Find the best matching category using vector similarity.
     * Always returns a match (no threshold) - the closest category is always assigned.
     */
    findBestMatch(
        embedding: number[]
    ): Promise<Result<CategoryVectorMatch, DomainError>>;

    /**
     * Find a category by its canonical id (slug), or null if none exists.
     * Used to resolve a controlled-vocabulary category name to a row.
     */
    findByCanonicalId(
        canonicalId: string
    ): Promise<Result<Category | null, DomainError>>;
}
