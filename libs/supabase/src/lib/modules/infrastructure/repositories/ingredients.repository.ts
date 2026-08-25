import {
    AliasTarget,
    ComponentKindValue,
    DietaryPropertyValue,
    IIngredientsRepository,
    VectorMatch,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";
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

    /**
     * Resolves alias canonical ids to ingredient ids.
     *
     * Keyed on `alias_canonical_id`, NOT on `alias`. The literal lookup this
     * replaced compared Title-Case model output ("Green Onion") against aliases
     * stored lowercase ("green onion") — PostgREST `.in()` is case-sensitive, so
     * it missed on effectively every name the generator emits, while the table
     * held the correct answer. That single miss is what created the duplicate
     * `Green Onion`, `Spring Onion`, `All Purpose Flour` and `Active Dry Yeast`
     * rows: the alias step silently fell through to vector search every time.
     *
     * Callers pass canonical ids (`ingredientCanonicalId(name)`) so the identity
     * rule is applied once, on their side, and matches what the trigger stored.
     */
    async findByAliasCanonicalIds(
        canonicalIds: string[]
    ): Promise<Result<Map<string, AliasTarget>, DomainError>> {
        if (canonicalIds.length === 0) return success(new Map());

        try {
            // The target's NAME comes back with the id because the caller has to
            // structurally compare the two before trusting the alias — a
            // sibling-shaped alias is where this table's own errors concentrate
            // (`red bell pepper -> Green Bell Pepper` is a real row, learned at
            // runtime by an adjudicator that got it wrong).
            const { data, error } = await supabaseAdmin
                .from("ingredient_aliases")
                .select("alias_canonical_id, ingredient_id, ingredients(name)")
                .in("alias_canonical_id", canonicalIds);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, AliasTarget>();
            if (data) {
                data.forEach((row) => {
                    const target = row.ingredients as { name: string } | null;
                    if (!target) return;
                    resultMap.set(row.alias_canonical_id, {
                        id: row.ingredient_id,
                        name: target.name,
                    });
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
            // Idempotent: `alias_canonical_id` is unique — do nothing if this
            // name already resolves (first writer wins; we don't repoint an
            // existing alias). Conflict is declared on the CANONICAL column
            // because that is the real identity: `alias` alone is
            // case-sensitive, so "Green Onion" and "green onion" would both
            // insert and the second would shadow nothing.
            const { error } = await supabaseAdmin
                .from("ingredient_aliases")
                .upsert(
                    {
                        ingredient_id: ingredientId,
                        alias,
                        // Stamped again by `set_alias_canonical_id` on the way
                        // in — the trigger overwrites this unconditionally, so
                        // the database stays the authority and a drift here
                        // cannot corrupt a row. It is sent because the column is
                        // NOT NULL with no DEFAULT, which is all the generated
                        // `Insert` type can see: a trigger is invisible to it.
                        // `ingredients.canonical_id` is the same shape and is
                        // supplied the same way from `match-ingredients`.
                        //
                        // `ingredientCanonicalId` and not `canonicalizeName`:
                        // this is the singularising rule, the one
                        // `findByAliasCanonicalIds` reads back with, and the one
                        // the trigger mirrors.
                        alias_canonical_id: ingredientCanonicalId(alias),
                    },
                    {
                        onConflict: "alias_canonical_id",
                        ignoreDuplicates: true,
                    }
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

    /**
     * Nearest ingredients by name embedding, best first.
     *
     * This used to take `match_count: 1`, and that single candidate is what let
     * duplicates through. Name embeddings are LEXICAL, so a shared head noun
     * dominates the score — which means rank 1 is systematically a SIBLING and
     * the synonym sits further down. Measured on the live catalogue:
     *
     *   "Green Onion"      -> 1. White Onion 0.802   (Scallion is 0.681, unranked)
     *   "Soya Sauce"       -> 1. Sweet Soy Sauce 0.871 (Soy Sauce is 3rd, 0.819)
     *   "Active Dry Yeast" -> 1. Instant Yeast 0.665 (Yeast is 2nd, 0.603)
     *
     * In each case the adjudicator was asked about the wrong ingredient,
     * correctly said "not the same", and a duplicate was created. Retrieval has
     * to be wide enough for the synonym to appear at all.
     *
     * Widening is only safe with the structural filter in front of the
     * adjudicator (`isAdjudicableCandidate`) — more candidates means more
     * siblings offered, and a sibling offered is an opportunity to merge Rice
     * Flour into Flour.
     */
    async vectorSearchMany(
        embedding: number[],
        threshold: number,
        limit: number
    ): Promise<Result<VectorMatch[], DomainError>> {
        try {
            // Convert embedding array to the format Supabase expects (JSON string)
            const { data, error } = await supabaseAdmin.rpc("search_ingredients", {
                query_embedding: JSON.stringify(embedding),
                match_threshold: threshold,
                match_count: limit,
            });

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            if (!data || data.length === 0) {
                return success([]);
            }

            // One round trip for the whole shortlist rather than one per hit.
            const { data: ingredientData, error: ingredientError } =
                await supabaseAdmin
                    .from("ingredients")
                    .select("*")
                    .in("id", data.map((row) => row.id));

            if (ingredientError) {
                return failure(new PersistenceError(ingredientError.message));
            }

            const byId = new Map(
                (ingredientData ?? []).map((row) => [row.id, row as Ingredient])
            );

            // `search_ingredients` already orders by distance; preserve it
            // rather than relying on the `.in()` fetch coming back sorted.
            const matches = data
                .map((row) => {
                    const ingredient = byId.get(row.id);
                    return ingredient
                        ? { ingredient, similarity: row.similarity }
                        : null;
                })
                .filter((match): match is VectorMatch => match !== null);

            return success(matches);
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

    async findUnembedded(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>> {
        if (ids.length === 0) return success([]);

        try {
            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .select("id, name")
                .in("id", ids)
                .is("embedding", null);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data ?? []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find unembedded ingredients: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async setEmbedding(
        ingredientId: string,
        embedding: number[]
    ): Promise<Result<void, DomainError>> {
        try {
            // An UPDATE of exactly this column, never an upsert, for the reason
            // `setDietaryProperties` gives. Serialised with JSON.stringify to
            // match how `create` writes the same column — pgvector arrives and
            // leaves as a JSON string over PostgREST.
            const { error } = await supabaseAdmin
                .from("ingredients")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", ingredientId);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to set ingredient embedding: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async findUnclassifiedComponents(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>> {
        if (ids.length === 0) return success([]);

        try {
            const { data, error } = await supabaseAdmin
                .from("ingredients")
                .select("id, name")
                .in("id", ids)
                .is("component_kind", null);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data ?? []);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find unclassified components: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async setComponent(
        ingredientId: string,
        kind: ComponentKindValue,
        dish: string | null
    ): Promise<Result<void, DomainError>> {
        try {
            // An UPDATE of exactly these two columns, never an upsert, for the
            // reason `setDietaryProperties` gives. `component_dish` is written
            // even when null: the check constraint requires it to be null for
            // anything that is not a dish, and writing it is what clears a stale
            // name when a reclassification demotes a row.
            const { error } = await supabaseAdmin
                .from("ingredients")
                .update({
                    component_kind: kind,
                    component_dish: kind === "dish" ? dish : null,
                })
                .eq("id", ingredientId);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(undefined);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to set ingredient component: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }
}
