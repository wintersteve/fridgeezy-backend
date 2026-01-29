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
}
