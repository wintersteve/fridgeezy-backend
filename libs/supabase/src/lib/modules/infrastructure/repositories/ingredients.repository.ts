import {
    DietaryPropertyValue,
    IIngredientsRepository,
    VectorMatch,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Ingredient, IngredientInsertPayload } from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

export class IngredientsRepository implements IIngredientsRepository {
    async findByCanonicalIds(
        ids: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>> {
        try {
            const { data, error } = await supabaseAdmin
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
            const { data, error } = await supabaseAdmin
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

    async findByIds(
        ids: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>> {
        try {
            if (ids.length === 0) return success(new Map());

            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .select("*")
                .in("id", ids);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Ingredient>();
            if (data) {
                data.forEach((ingredient) => {
                    resultMap.set(ingredient.id, ingredient as Ingredient);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find ingredients by ids: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findByAliases(
        aliases: string[]
    ): Promise<Result<Map<string, string>, DomainError>> {
        try {
            const { data, error } = await supabaseAdmin
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
            const { error } = await supabaseAdmin
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
            const { data, error } = await supabaseAdmin.rpc("search_ingredients", {
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
                await supabaseAdmin
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
            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .insert(ingredient)
                .select()
                .single();

            if (error) {
                // Concurrent create race (duplicate canonical_id): reuse the row
                // that won rather than failing the whole suggestion.
                if (error.code === "23505" && ingredient.canonical_id) {
                    const existing = await supabaseAdmin
                        .from("ingredients")
                        .select()
                        .eq("canonical_id", ingredient.canonical_id)
                        .single();
                    if (!existing.error && existing.data) {
                        return success(existing.data as Ingredient);
                    }
                }
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

    async findUnclassifiedDietary(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>> {
        if (ids.length === 0) return success([]);

        try {
            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .select("id, name")
                .in("id", ids)
                .is("dietary_classified_at", null);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data ?? []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find unclassified ingredients: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async setDietaryProperties(
        ingredientId: string,
        properties: DietaryPropertyValue[]
    ): Promise<Result<void, DomainError>> {
        try {
            // An UPDATE of exactly these two columns, never an upsert: an upsert
            // would have to restate every NOT NULL column of `ingredients`, and
            // getting one wrong would overwrite real data.
            const { error } = await supabaseAdmin
                .from("ingredients")
                .update({
                    dietary_properties: properties,
                    dietary_classified_at: new Date().toISOString(),
                })
                .eq("id", ingredientId);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to set dietary properties: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }
}
