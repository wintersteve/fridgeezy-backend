import { failure, PersistenceError, Result } from "@fridgeezy/domain";
import { generateEmbedding } from "@fridgeezy/openai";
import { GenerateSuggestionResponseDto, SuggestionTagDto } from "@fridgeezy/schemas";
import { SuggestionsRepository, supabaseAdmin } from "@fridgeezy/supabase";

import { matchIngredients, IngredientMatch } from "./match-ingredients";
import { matchTags, TagInput, TagMatch } from "./match-tags";
import { buildSuggestionSignature } from "./suggestion-signature";

/**
 * Reads the display names for a set of ingredient ids as a lookup.
 *
 * Matching returns ids plus whatever the model called each thing; the catalog's
 * own name is not carried through (the alias branch never has it to hand), so
 * it is read back here in one query rather than threaded through every match
 * site.
 */
async function lookupIngredientNames(
    ids: string[]
): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, name")
        .in("id", unique);

    if (error) {
        // Non-fatal: the caller falls back to the model's spelling. The
        // suggestion is already persisted by this point and must not be lost
        // over a cosmetic lookup.
        console.warn(
            `[Suggestions] Could not read ingredient names: ${error.message}`
        );
        return new Map();
    }

    return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/**
 * The same lookup for tags, which additionally carries `type`.
 *
 * Type is what the card's "CUISINE · KIND" eyebrow is built from, and it cannot
 * be inferred from the match: `matchTags` resolves a name onto a row and only
 * that row knows whether it is a cuisine, a dish form or a dietary label. This
 * is the streaming half of the pair — `fetchEnrichedSuggestion` reads the same
 * three columns for every other path into a card, and the two must agree or a
 * dish describes itself differently depending on how it was reached.
 */
async function lookupTags(
    ids: string[]
): Promise<Map<string, { name: string; type: PersistedTag["type"] }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
        .from("tags")
        .select("id, name, type")
        .in("id", unique);

    if (error) {
        console.warn(
            `[Suggestions] Could not read tag names: ${error.message}`
        );
        return new Map();
    }

    return new Map(
        (data ?? []).map((row) => [
            row.id,
            { name: row.name, type: row.type ?? undefined },
        ])
    );
}

export interface PersistSuggestionContext {
    /** The cuisine from the original request - will be marked as type: "cuisine" for auto-creation */
    cuisineTag?: string;
    /**
     * The dish's ALTERNATE name, stored in the `name_en` column. Null/absent for
     * the many dishes known by only one name — the model is told not to echo
     * `name` — so this is genuinely optional rather than "not supplied yet".
     */
    nameEn?: string | null;
    /**
     * Precomputed signature embedding. persist-or-reuse already embeds the
     * signature to run the dedup search — passing it here avoids re-embedding the
     * identical signature for storage.
     */
    signatureEmbedding?: number[];
    /**
     * The cuisine half of dish identity, already resolved by
     * `persistOrReuseSuggestion` for its dedup lookups and passed down rather
     * than recomputed — the two MUST agree, or a row is stored under an identity
     * different from the one dedup just searched.
     */
    identityCuisine?: string | null;
}

export interface PersistedIngredient {
    id: string;
    name: string;
}

export interface PersistedTag {
    id: string;
    name: string;
    /**
     * Which facet this tag is — cuisine, dish form, course, component, dietary.
     *
     * Optional only because the lookup that fills it is non-fatal (see
     * {@link lookupTags}); every real row has one. A card missing it draws no
     * eyebrow, exactly as one whose dish carries no cuisine tag does.
     */
    type?: SuggestionTagDto["type"];
}

export interface PersistedSuggestion {
    suggestionId: string;
    ingredients: PersistedIngredient[];
    tags: PersistedTag[];
}

/**
 * Persists a recipe suggestion with its ingredient and tag relations
 *
 * This orchestrator:
 * 1. Matches ingredients using 4-step fallback (name → alias → vector → create)
 * 2. Matches tags using 3-step fallback (canonical_id → vector → create for cuisines)
 * 3. Atomically persists suggestion with all relations
 *
 * @param suggestion The suggestion to persist
 * @param context Optional context with cuisine tag from the original request
 * @returns Result containing the created suggestion UUID and matched ingredient/tag IDs
 */
export async function persistSuggestion(
    suggestion: GenerateSuggestionResponseDto,
    context?: PersistSuggestionContext
): Promise<Result<PersistedSuggestion, PersistenceError>> {
    try {
        // Build typed tag inputs - mark the cuisine tag from context as type: "cuisine"
        const tagInputs: TagInput[] = suggestion.tags.map((tag) => {
            // If this tag matches the cuisine from context, mark it as cuisine type
            if (
                context?.cuisineTag &&
                tag.toLowerCase() === context.cuisineTag.toLowerCase()
            ) {
                return { name: tag, type: "cuisine" as const };
            }
            return { name: tag };
        });

        // The dish SIGNATURE embedding (canonical name + tags + ingredients) is
        // what makes cross-name dedup work; embed it app-side so Postgres never
        // calls OpenAI. Reuse the caller's embedding when provided (persist-or-reuse
        // already computed it for the dedup search) — otherwise embed here.
        const signaturePromise = context?.signatureEmbedding
            ? Promise.resolve(context.signatureEmbedding)
            : generateEmbedding(
                  buildSuggestionSignature({
                      name: suggestion.name,
                      tags: suggestion.tags,
                      ingredients: suggestion.ingredients,
                  })
              );

        // Ingredient match, tag match, and the signature embedding are
        // independent — run them concurrently.
        const [ingredientMatchesResult, tagMatchesResult, nameEmbedding] =
            await Promise.all([
                matchIngredients(suggestion.ingredients),
                matchTags(tagInputs),
                signaturePromise,
            ]);

        if (!ingredientMatchesResult.success) {
            console.error(
                `Failed to match ingredients for "${suggestion.name}":`,
                ingredientMatchesResult.error
            );
            return ingredientMatchesResult;
        }
        if (!tagMatchesResult.success) {
            console.error(
                `Failed to match tags for "${suggestion.name}":`,
                tagMatchesResult.error
            );
            return tagMatchesResult;
        }

        const ingredientMatches = ingredientMatchesResult.value;
        const tagMatches = tagMatchesResult.value;

        // Persist suggestion with relations
        const suggestionsRepo = new SuggestionsRepository();
        const persistResult = await suggestionsRepo.persistWithRelations(
            {
                name: suggestion.name,
                description: suggestion.description,
                difficulty: suggestion.difficulty,
            },
            ingredientMatches.map((m) => m.ingredientId),
            tagMatches.map((m) => m.tagId),
            nameEmbedding,
            // Omitted rather than null, so the RPC's own default applies.
            context?.nameEn ?? undefined,
            context?.identityCuisine,
            // Straight off the model's own frame rather than the context: it is
            // a property of the DISH, so unlike `adaptedFor` (per-request) it
            // belongs on the row that dedup will share.
            suggestion.total_time_minutes
        );

        if (!persistResult.success) {
            console.error(
                `Failed to persist suggestion "${suggestion.name}":`,
                persistResult.error
            );
            return persistResult;
        }

        // Log successful persistence with match details
        const ingredientStats = {
            exact: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "exact_name"
            ).length,
            alias: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "alias"
            ).length,
            vector: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "vector"
            ).length,
            created: ingredientMatches.filter(
                (m: IngredientMatch) => m.matchType === "created"
            ).length,
        };

        const tagStats = {
            canonical_id: tagMatches.filter(
                (m: TagMatch) => m.matchType === "canonical_id"
            ).length,
            vector: tagMatches.filter(
                (m: TagMatch) => m.matchType === "vector"
            ).length,
            created: tagMatches.filter(
                (m: TagMatch) => m.matchType === "created"
            ).length,
        };

        console.log(
            `[Suggestions] Persisted: ${suggestion.name} (${persistResult.value})`,
            {
                ingredients: ingredientStats,
                tags: tagStats,
            }
        );

        // Names come from the CATALOG rows, not from what the model called them.
        // The id and the name have to describe the same thing: a match resolves
        // "tomatoes" onto the existing `Tomato` row, and returning the model's
        // spelling next to that row's id makes the pair incoherent. It also
        // disagreed with the promote path — fetchEnrichedSuggestion joins
        // `ingredients`/`tags` and returns their names — so the same suggestion
        // reported different ingredients depending on which endpoint was called.
        const [ingredientNames, tagRows] = await Promise.all([
            lookupIngredientNames(ingredientMatches.map((m) => m.ingredientId)),
            lookupTags(tagMatches.map((m) => m.tagId)),
        ]);

        return {
            success: true,
            value: {
                suggestionId: persistResult.value,
                ingredients: ingredientMatches.map((m) => ({
                    id: m.ingredientId,
                    // Falls back to the model's spelling only if the row somehow
                    // could not be read back — better a stale name than none.
                    name: ingredientNames.get(m.ingredientId) ?? m.originalName,
                })),
                tags: tagMatches.map((m) => ({
                    id: m.tagId,
                    name: tagRows.get(m.tagId)?.name ?? m.originalName,
                    type: tagRows.get(m.tagId)?.type,
                })),
            },
        };
    } catch (error) {
        const errorMessage = `Failed to persist suggestion: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(errorMessage, error);
        return failure(new PersistenceError(errorMessage));
    }
}
