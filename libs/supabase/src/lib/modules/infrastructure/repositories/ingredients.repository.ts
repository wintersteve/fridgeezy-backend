import {
    IIngredientsRepository,
    VectorMatch,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Ingredient, IngredientInsertPayload } from "@fridgeezy/types";

import { supabase } from "../../client";

export class IngredientsRepository implements IIngredientsRepository {
    async findByCanonicalIds(
        ids: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("ingredients")
                .select("*")
                .in("canonical_id", ids);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Ingredient>();
            if (data) {
                data.forEach((ingredient) => {
                    resultMap.set(ingredient.canonical_id, ingredient as Ingredient);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find ingredients by names: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findByNames(
        names: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("ingredients")
                .select("*")
                .in("name", names);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Ingredient>();
            if (data) {
                data.forEach((ingredient) => {
                    resultMap.set(ingredient.name, ingredient as Ingredient);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find ingredients by names: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findByAliases(
        aliases: string[]
    ): Promise<Result<Map<string, string>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("ingredient_aliases")
                .select("alias, ingredient_id")
                .in("alias", aliases);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, string>();
            if (data) {
                data.forEach((row) => {
                    resultMap.set(row.alias, row.ingredient_id);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find ingredients by aliases: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async addAlias(
        ingredientId: string,
        alias: string
    ): Promise<Result<void, DomainError>> {
        try {
            // Idempotent: the alias column is unique — do nothing if it already
            // exists (first writer wins; we don't repoint an existing alias).
            const { error } = await supabase
                .from("ingredient_aliases")
                .upsert(
                    { ingredient_id: ingredientId, alias },
                    { onConflict: "alias", ignoreDuplicates: true }
                );

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to add ingredient alias: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async vectorSearch(
        embedding: number[],
        threshold: number
    ): Promise<Result<VectorMatch | null, DomainError>> {
        try {
            // Convert embedding array to the format Supabase expects (JSON string)
            const { data, error } = await supabase.rpc("search_ingredients", {
                query_embedding: JSON.stringify(embedding),
                match_threshold: threshold,
                match_count: 1,
            });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data || data.length === 0) {
                return success(null);
            }

            // Fetch the full ingredient data
            const { data: ingredientData, error: ingredientError } =
                await supabase
                    .from("ingredients")
                    .select("*")
                    .eq("id", data[0].id)
                    .single();

            if (ingredientError) {
                return failure(new PersistenceError(ingredientError.message));
            }

            return success({
                ingredient: ingredientData as Ingredient,
                similarity: data[0].similarity,
            });
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to perform vector search: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async create(
        ingredient: IngredientInsertPayload
    ): Promise<Result<Ingredient, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("ingredients")
                .insert(ingredient)
                .select()
                .single();

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data as Ingredient);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to create ingredient: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }
}
