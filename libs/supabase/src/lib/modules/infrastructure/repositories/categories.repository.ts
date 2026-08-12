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

import { supabaseAdmin } from "../../client";

export class CategoriesRepository implements ICategoriesRepository {
    async findBestMatch(
        embedding: number[]
    ): Promise<Result<CategoryVectorMatch, DomainError>> {
        const { data, error } = await supabaseAdmin.rpc("search_categories", {
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

        const { data: categoryData, error: categoryError } = await supabaseAdmin
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

    async findByCanonicalId(
        canonicalId: string
    ): Promise<Result<Category | null, DomainError>> {
        const { data, error } = await supabaseAdmin
            .from("categories")
            .select("*")
            .eq("canonical_id", canonicalId)
            .maybeSingle();

        if (error) {
            return failure(new PersistenceError(error.message));
        }

        return success((data as Category | null) ?? null);
    }
}
