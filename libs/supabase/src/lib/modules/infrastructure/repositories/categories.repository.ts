import {
    CategoryVectorMatch,
    DomainError,
    failure,
    ICategoriesRepository,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Category } from "@fridgeezy/types";

import { supabase } from "../../client";

export class CategoriesRepository implements ICategoriesRepository {
    async findBestMatch(
        embedding: number[]
    ): Promise<Result<CategoryVectorMatch, DomainError>> {
        const { data, error } = await supabase.rpc("search_categories", {
            query_embedding: JSON.stringify(embedding),
            match_count: 1,
        });

        if (error) {
            return failure(new PersistenceError(error.message));
        }

        if (!data || data.length === 0) {
            return failure(
                new PersistenceError(
                    "No categories found - ensure category embeddings are populated"
                )
            );
        }

        const { data: categoryData, error: categoryError } = await supabase
            .from("categories")
            .select("*")
            .eq("id", data[0].id)
            .single();

        if (categoryError) {
            return failure(new PersistenceError(categoryError.message));
        }

        return success({
            category: categoryData as Category,
            similarity: data[0].similarity,
        });
    }
}
