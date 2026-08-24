import { Enums, Ingredient, IngredientInsertPayload } from "@fridgeezy/types";

import { DomainError, Result } from "../../shared";

/** The database's objective dietary property enum. */
export type DietaryPropertyValue = Enums<"dietary_property">;
export type ComponentKindValue = Enums<"component_kind">;

export interface VectorMatch {
    ingredient: Ingredient;
    similarity: number;
}

/**
 * What an alias resolves to. The NAME rides along with the id because a caller
 * must be able to structurally compare the two before trusting the mapping —
 * `ingredient_aliases` holds errors of its own, and they concentrate in
 * sibling-shaped pairs (`red bell pepper -> Green Bell Pepper` is a real row).
 */
export interface AliasTarget {
    id: string;
    name: string;
}

export interface IIngredientsRepository {
    /**
     * Find ingredients by their exact names (batch operation)
     * @param names Array of ingredient names to search for
     * @returns Map of name → Ingredient for found matches
     */
    findByNames(
        names: string[]
    ): Promise<Result<Map<string, Ingredient>, DomainError>>;

    /**
     * Find ingredients by their primary keys (batch operation)
     * @param ids Array of ingredient ids to fetch
     * @returns Map of id → Ingredient for found matches
     */
    findByIds(ids: string[]): Promise<Result<Map<string, Ingredient>, DomainError>>;

    /**
     * Find ingredients by matching aliases (batch operation), keyed on the
     * CANONICAL form of the alias rather than its literal text — the literal
     * comparison was case-sensitive and missed on every Title-Case name.
     * @param canonicalIds Array of `ingredientCanonicalId(name)` values
     * @returns Map of alias canonical id → target for found matches
     */
    findByAliasCanonicalIds(
        canonicalIds: string[]
    ): Promise<Result<Map<string, AliasTarget>, DomainError>>;

    /**
     * Record a learned alias → ingredient mapping. Idempotent: an alias that
     * already exists is left untouched.
     * @param ingredientId The canonical ingredient the alias points to
     * @param alias The surface name to alias
     */
    addAlias(
        ingredientId: string,
        alias: string
    ): Promise<Result<void, DomainError>>;

    /**
     * Search for ingredients using vector similarity, nearest first.
     *
     * Returns a LIST rather than the single best match. Name embeddings are
     * lexical, so a shared head noun dominates the score and rank 1 is
     * systematically a sibling ("Green Onion" returns White Onion before
     * Scallion); one candidate meant the adjudicator was asked about the wrong
     * ingredient and duplicates were created.
     *
     * @param embedding Vector embedding (1536 dimensions)
     * @param threshold Similarity threshold (0.0-1.0)
     * @param limit Maximum candidates to return
     */
    vectorSearchMany(
        embedding: number[],
        threshold: number,
        limit: number
    ): Promise<Result<VectorMatch[], DomainError>>;

    /**
     * Create a new ingredient
     * @param ingredient Ingredient data to insert
     * @returns Created ingredient with generated ID
     */
    create(
        ingredient: IngredientInsertPayload
    ): Promise<Result<Ingredient, DomainError>>;

    /**
     * Of the given ids, those nobody has dietary-classified yet.
     * @param ids Candidate ingredient ids
     * @returns id + name for the rows whose `dietary_classified_at` is null
     */
    findUnclassifiedDietary(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>>;

    /**
     * Record an ingredient's dietary properties, stamping it as classified.
     *
     * An empty array is a real answer — "carries none of them" — and is what
     * makes a dish readable as vegan. It is NOT the same as never having asked,
     * which is why the timestamp is written here rather than inferred from the
     * array being non-empty.
     */
    setDietaryProperties(
        ingredientId: string,
        properties: DietaryPropertyValue[]
    ): Promise<Result<void, DomainError>>;

    /**
     * Of the given ids, those with no name embedding.
     *
     * A null embedding is not a cosmetic gap: `vectorSearch` can never return
     * such a row, so it is unreachable by the resolver's retrieval layer and
     * every later occurrence of its name creates a fresh duplicate beside it.
     * Only the SQL persist path produces them — see {@link setEmbedding}.
     *
     * @param ids Candidate ingredient ids
     * @returns id + name for the rows whose `embedding` is null
     */
    findUnembedded(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>>;

    /**
     * Give an ingredient the name embedding the resolver searches on.
     *
     * Written from the name alone, which is what `seed-ingredients`,
     * `operations/generate-embeddings.ts` and `matchIngredients` all embed —
     * stored vectors and query vectors must be built by the same rule or
     * similarity silently stops meaning anything.
     */
    setEmbedding(
        ingredientId: string,
        embedding: number[]
    ): Promise<Result<void, DomainError>>;

    /**
     * Of the given ids, those nobody has component-classified yet.
     * @param ids Candidate ingredient ids
     * @returns id + name for the rows whose `component_kind` is null
     */
    findUnclassifiedComponents(
        ids: string[]
    ): Promise<Result<Array<Pick<Ingredient, "id" | "name">>, DomainError>>;

    /**
     * Record whether an ingredient is a dish you make, prep you do, or a
     * product you buy — and, for a dish, the name that opens it.
     *
     * No timestamp, unlike {@link setDietaryProperties}: `bought` IS the
     * checked-and-nothing-to-offer answer, so a null `component_kind` already
     * means unclassified and nothing else.
     */
    setComponent(
        ingredientId: string,
        kind: ComponentKindValue,
        dish: string | null
    ): Promise<Result<void, DomainError>>;
}
