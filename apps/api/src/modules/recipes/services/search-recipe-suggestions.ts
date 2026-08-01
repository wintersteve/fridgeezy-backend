import { randomUUID } from "node:crypto";

import { RecipesRepository } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import { generateSuggestionsStream } from "../../suggestions/services/generate-suggestions-stream";
import { streamSingleSuggestion } from "../../suggestions/services/stream-single-suggestion";

import { fetchRecipeSummary } from "./fetch-recipe-summary";
import { findCatalogueRecipes } from "./find-catalogue-recipes";
import { searchRecipes } from "./search-recipes";

/**
 * Recalibrated 2026-07-31 against the queries chat actually sends. 0.70 was
 * measured on dish-name-like inputs, but the only caller passes the user's own
 * phrasing, and a natural-language QUESTION scores far lower against a dish
 * signature than another dish name does. Measured over the live catalog:
 *
 *   "how do I make palak paneer?"           -> Palak Paneer      0.641
 *   "I fancy something with spinach+paneer" -> Palak Paneer      0.620
 *   "something with kimchi"                 -> Kimchi Fried Rice 0.606
 *   "show me an apple dessert"              -> Apple Strudel     0.515
 *   noise across those same queries         -> 0.30–0.46
 *
 * At 0.70 every one of those was rejected and chat generated a fresh suggestion
 * for a dish it already had. 0.50 clears the highest observed false positive
 * (0.461) and accepts all of them.
 *
 * Still biased high relative to the noise floor, because the failure modes are
 * not symmetric: too low returns the WRONG recipe and suppresses generation
 * entirely, while too high merely spends a generation that
 * `persistOrReuseSuggestion` then resolves back to the existing recipe. Exact
 * names don't depend on this number at all (stage 1a), and ingredient questions
 * are answered by stage 1c rather than by similarity.
 */
const DEFAULT_MATCH_THRESHOLD = 0.5;

/**
 * The canonical `component` tag vocabulary, mirroring `seeds/002_tags.sql`.
 * Every recipe and suggestion carries exactly one of these, which makes it the
 * one reliable way to tell "a sauce" from "a dish that has a sauce in it" —
 * similarity search cannot: "sauce for apple strudel" scores highest against
 * Apple Strudel itself, so a component question always answered with the dish.
 */
export const COMPONENT_TAGS = [
    "sauce",
    "stock",
    "gravy",
    "roux",
    "slurry",
    "spice blend",
    "paste",
    "rub",
    "marinade",
    "brine",
    "cure",
    "dough",
    "batter",
    "pastry",
    "vinaigrette",
    "dressing",
    "custard",
    "curd",
    "caramel",
    "crumb",
    "pickle",
    "jam",
    "compote",
    "syrup",
    "glaze",
    "icing",
    "dish",
    "puree",
] as const;

export type ComponentTag = (typeof COMPONENT_TAGS)[number];

export interface RecipeSuggestionInput {
    query: string;
    matchThreshold?: number;
    maxResults?: number;
    /**
     * Concrete ingredients the user named ("chicken", "rice"), extracted by the
     * model from its own query. Drives stage 1c's `find_recipes` lookup, which
     * is the only stage that can answer an ingredient question — similarity
     * search cannot (see DEFAULT_MATCH_THRESHOLD). Absent for queries that name
     * a dish or a concept rather than ingredients.
     */
    ingredients?: string[];
    /**
     * Dish names already shown earlier in the conversation, filtered out of
     * every catalogue stage.
     *
     * Without it a follow-up about an ACCOMPANIMENT re-matched the dish it
     * accompanies: "sauce for chicken parmesan" scores well above
     * DEFAULT_MATCH_THRESHOLD against Chicken Parmesan's own signature, so
     * stage 1b returned that recipe, the early return fired, and stage 3 never
     * got to generate the sauce. Excluding it lets the search fall through to
     * generation, which is what the question actually asked for.
     */
    exclude?: string[];
    /**
     * The component type the user actually asked for ("sauce", "marinade"). Set
     * only for component questions; when present, every catalogue stage keeps
     * just the rows carrying that component tag and stage 3 is told to generate
     * one. This is what stops "what sauce goes with apple strudel" from being
     * answered with Apple Strudel — the exclusion above only covers dishes we
     * can name up front.
     */
    component?: ComponentTag;
    /** Dietary tags any generated suggestion must satisfy. */
    dietaryRestrictions?: string[];
    /** Ingredients to never suggest (allergies/dislikes). */
    blacklist?: string[];
}

export interface RecipeSuggestionItem {
    id: string;
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    source: "existing_recipe" | "suggestion" | "new_suggestion";
    /**
     * Hero image, present only for `existing_recipe`. The chat card falls back
     * to its "NEW" panel without one, so omitting it made a recipe the catalogue
     * already has render exactly like a dish that had just been invented — the
     * card was wrong even though its id, and so the tap-through, was right.
     */
    image?: string | null;
    matchScore?: number;
    ingredients: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string }>;
    /**
     * Present only for LLM-generated suggestions: correlates this (enriched)
     * item with the partial that was emitted via `onPartialSuggestion` before
     * persistence, so a streaming caller can upgrade the card in place.
     */
    tempId?: string;
}

/**
 * A generated suggestion streaming in field-by-field, before persistence — no
 * ids, raw string ingredients/tags. Emitted repeatedly (cumulatively) via
 * `onPartialSuggestion` as each field lands, so a caller can reveal the card
 * one field at a time. `name` is always present (it streams first); everything
 * else fills in over subsequent frames. The final enriched item shares `tempId`.
 */
export interface PartialRecipeSuggestion {
    tempId: string;
    source: "new_suggestion";
    name: string;
    description?: string;
    difficulty?: "easy" | "medium" | "hard";
    ingredients?: string[];
    tags?: string[];
}

export interface SearchRecipeSuggestionsOptions {
    /**
     * Present for streaming callers (chat). When set, stage 3 generates a SINGLE
     * suggestion and streams its fields out through this callback as they land;
     * when absent, stage 3 falls back to the multi-suggestion JSONL generator.
     */
    onPartialSuggestion?: (partial: PartialRecipeSuggestion) => void;
}

export interface SearchMetadata {
    vectorSearchHits: number;
    canonicalSearchHits: number;
    newSuggestionsCreated: number;
}

export interface RecipeSuggestionResult {
    suggestions: RecipeSuggestionItem[];
    searchMetadata: SearchMetadata;
}

/**
 * Search for recipe suggestions using a 3-stage approach:
 * 1. Vector search on recipes table
 * 2. Canonical search on suggestions table
 * 3. Create new suggestions if nothing found
 *
 * @param input Search parameters
 * @returns Suggestions with metadata about search results
 */
export async function searchRecipeSuggestions(
    input: RecipeSuggestionInput,
    options: SearchRecipeSuggestionsOptions = {}
): Promise<RecipeSuggestionResult> {
    const {
        query,
        matchThreshold = DEFAULT_MATCH_THRESHOLD,
        maxResults = 5,
        ingredients,
        exclude,
        component,
        dietaryRestrictions,
        blacklist,
    } = input;
    const { onPartialSuggestion } = options;

    const excluded = new Set((exclude ?? []).map(canonicalizeName));
    const isExcluded = (...names: Array<string | null | undefined>) =>
        names.some((name) => !!name && excluded.has(canonicalizeName(name)));

    // No component asked for means no component filter — every row qualifies.
    const wanted = component ? canonicalizeName(component) : null;
    const isWantedComponent = (tags: Array<{ name: string }>) =>
        !wanted || tags.some((tag) => canonicalizeName(tag.name) === wanted);

    const suggestions: RecipeSuggestionItem[] = [];
    const metadata: SearchMetadata = {
        vectorSearchHits: 0,
        canonicalSearchHits: 0,
        newSuggestionsCreated: 0,
    };

    // Stage 1a: exact name match. Recipes are embedded by dish SIGNATURE
    // (English name + tags + ingredients), which reads nothing like a short
    // foreign proper noun — "Toum" scores 0.239 against its own recipe, "Palak
    // Paneer" 0.524. Vector search cannot be the only way to find a recipe the
    // user named outright, so ask for it by name first.
    const namedRecipe = await new RecipesRepository().findBaseRecipe([query]);

    if (!namedRecipe.success) {
        console.error(
            `[SearchRecipeSuggestions] Name lookup failed for "${query}":`,
            namedRecipe.error.message
        );
    } else if (namedRecipe.value && !isExcluded(query)) {
        const summary = await fetchRecipeSummary(namedRecipe.value.id);

        if (
            summary &&
            !isExcluded(summary.name) &&
            isWantedComponent(summary.tags)
        ) {
            suggestions.push({
                id: summary.id,
                name: summary.name,
                description: summary.shortDescription || summary.description,
                image: summary.image,
                difficulty: summary.difficulty,
                source: "existing_recipe",
                matchScore: 1,
                ingredients: summary.ingredients,
                tags: summary.tags,
            });
            metadata.vectorSearchHits++;
        }
    }

    // Stage 1b: Vector search on recipes
    const vectorResults = (
        await searchRecipes(query, matchThreshold, maxResults)
    ).filter((result) => !suggestions.some((item) => item.id === result.id));

    // Fetch each hit's summary in parallel (independent reads) rather than one
    // round-trip per result, then assemble in the original ranked order.
    const summaries = await Promise.all(
        vectorResults.map((result) => fetchRecipeSummary(result.id))
    );

    vectorResults.forEach((result, i) => {
        const recipeSummary = summaries[i];

        if (
            recipeSummary &&
            !isExcluded(recipeSummary.name) &&
            isWantedComponent(recipeSummary.tags)
        ) {
            suggestions.push({
                id: recipeSummary.id,
                name: recipeSummary.name,
                description:
                    recipeSummary.shortDescription || recipeSummary.description,
                image: recipeSummary.image,
                difficulty: recipeSummary.difficulty,
                source: "existing_recipe",
                matchScore: result.score,
                ingredients: recipeSummary.ingredients.map((ing) => ({
                    id: ing.id,
                    name: ing.name,
                })),
                tags: recipeSummary.tags.map((tag) => ({
                    id: tag.id,
                    name: tag.name,
                })),
            });
            metadata.vectorSearchHits++;
        }
    });

    // Stage 1c: the catalogue lookup the SEARCH SCREEN uses — filter by
    // ingredient id via `find_recipes`, no similarity involved.
    //
    // Stages 1a and 1b between them only find a dish the user all but named:
    // measured, "what can I make with chicken and rice?" scores 0.429 against
    // even the right recipe, so no similarity gate can accept it without
    // accepting noise too. That question is a filter, not a search, and it is
    // the one the search screen answers well while chat did not answer at all —
    // it generated a new dish over a catalogue that already had one.
    //
    // Only runs when the model actually extracted ingredients, and its rows are
    // deduped against stages 1a/1b by id.
    if (ingredients?.length && suggestions.length < maxResults) {
        const catalogue = await findCatalogueRecipes({
            ingredients,
            blacklist,
            limit: maxResults,
        });

        for (const row of catalogue) {
            if (suggestions.some((item) => item.id === row.id)) continue;
            if (isExcluded(row.name)) continue;
            if (!isWantedComponent(row.tags)) continue;

            suggestions.push({
                id: row.id,
                name: row.name,
                description: row.description,
                image: row.image,
                difficulty: row.difficulty,
                // A `recipe` row is already generated, so the card opens it; a
                // `suggestion` row still routes to the generate screen.
                source:
                    row.source === "recipe" ? "existing_recipe" : "suggestion",
                ingredients: row.ingredients,
                tags: row.tags,
            });

            if (row.source === "recipe") {
                metadata.vectorSearchHits++;
            } else {
                metadata.canonicalSearchHits++;
            }
        }
    }

    // If we have enough results from the catalogue, return early
    if (suggestions.length >= maxResults) {
        return {
            suggestions: suggestions.slice(0, maxResults),
            searchMetadata: metadata,
        };
    }

    // Stage 2: Canonical search on suggestions table.
    //
    // Skipped when stage 1 already returned this dish: a suggestion row can
    // outlive its promotion (nothing deletes it if the user reached the recipe
    // another way), and surfacing both would show the same dish twice — once as
    // a recipe and once as a card offering to generate it again.
    const existingSuggestion = isExcluded(query)
        ? null
        : await findSuggestionByName(query);
    const alreadyListed =
        !!existingSuggestion &&
        (isExcluded(existingSuggestion.name, existingSuggestion.nameEn) ||
            !isWantedComponent(existingSuggestion.tags) ||
            suggestions.some(
                (item) =>
                    // By id as well as by name: stage 1c can surface this very
                    // suggestion row via find_recipes, and a name comparison
                    // alone would miss it if the two spellings ever diverge.
                    item.id === existingSuggestion.id ||
                    canonicalizeName(item.name) ===
                        canonicalizeName(existingSuggestion.name) ||
                    canonicalizeName(item.name) ===
                        canonicalizeName(existingSuggestion.nameEn)
            ));

    if (existingSuggestion && !alreadyListed) {
        suggestions.push({
            id: existingSuggestion.id,
            name: existingSuggestion.name,
            description: existingSuggestion.description,
            difficulty: existingSuggestion.difficulty,
            source: "suggestion",
            ingredients: existingSuggestion.ingredients.map((ing) => ({
                id: ing.id,
                name: ing.name,
            })),
            tags: existingSuggestion.tags.map((tag) => ({
                id: tag.id,
                name: tag.name,
            })),
        });
        metadata.canonicalSearchHits++;
    }

    // If we have enough results, return
    if (suggestions.length >= maxResults) {
        return {
            suggestions: suggestions.slice(0, maxResults),
            searchMetadata: metadata,
        };
    }

    // Stage 3: Generate new suggestions using LLM if nothing found
    if (suggestions.length === 0) {
        console.log(
            `[SearchRecipeSuggestions] No results found for "${query}", generating suggestions with LLM`
        );

        try {
            if (onPartialSuggestion) {
                // Streaming caller (chat): generate ONE suggestion and stream
                // its fields out — title first, then description, etc. — sharing
                // a tempId so the enriched item below upgrades the same card.
                const tempId = randomUUID();

                const outcome = await streamSingleSuggestion(
                    {
                        ingredients: [query],
                        component,
                        dietaryRestrictions,
                        blacklist,
                    },
                    {
                        onField: (fields) => {
                            // `name` streams first; hold the frame until it lands
                            // so the card never renders without a title.
                            if (!fields.name) return;
                            onPartialSuggestion({
                                tempId,
                                source: "new_suggestion",
                                name: fields.name,
                                description: fields.description,
                                difficulty: fields.difficulty,
                                ingredients: fields.ingredients,
                                tags: fields.tags,
                            });
                        },
                    }
                );

                if (outcome.kind === "suggestion") {
                    const enriched = outcome.suggestion;
                    suggestions.push({
                        id: enriched.id,
                        name: enriched.name,
                        description: enriched.description,
                        difficulty: enriched.difficulty,
                        source: "new_suggestion",
                        tempId,
                        ingredients: enriched.ingredients.map((ing) => ({
                            id: ing.id,
                            name: ing.name,
                        })),
                        tags: enriched.tags.map((tag) => ({
                            id: tag.id,
                            name: tag.name,
                        })),
                    });
                    metadata.newSuggestionsCreated++;
                } else if (outcome.kind === "existing_recipe") {
                    // The dish the model landed on is already a full recipe —
                    // stage 1's vector search just didn't recall it from this
                    // phrasing. Hand back the recipe (same tempId, so the card
                    // that streamed in upgrades in place) rather than minting a
                    // duplicate suggestion for something the user already has.
                    const recipe = outcome.recipe;
                    suggestions.push({
                        id: recipe.id,
                        name: recipe.name,
                        description:
                            recipe.shortDescription || recipe.description,
                        image: recipe.image,
                        difficulty: recipe.difficulty,
                        source: "existing_recipe",
                        tempId,
                        ingredients: recipe.ingredients,
                        tags: recipe.tags,
                    });
                    metadata.vectorSearchHits++;
                }
            } else {
                // Non-streaming caller: keep the multi-suggestion JSONL generator.
                let generatedCount = 0;
                const stream = generateSuggestionsStream({
                    ingredients: [query],
                    component,
                    dietaryRestrictions,
                    blacklist,
                });

                for await (const suggestion of stream) {
                    if (generatedCount >= maxResults) {
                        break;
                    }

                    suggestions.push({
                        id: suggestion.id,
                        name: suggestion.name,
                        description: suggestion.description,
                        difficulty: suggestion.difficulty,
                        source: "new_suggestion",
                        ingredients: suggestion.ingredients.map((ing) => ({
                            id: ing.id,
                            name: ing.name,
                        })),
                        tags: suggestion.tags.map((tag) => ({
                            id: tag.id,
                            name: tag.name,
                        })),
                    });
                    metadata.newSuggestionsCreated++;
                    generatedCount++;
                }
            }
        } catch (error) {
            console.error(
                `[SearchRecipeSuggestions] Failed to generate suggestions for "${query}":`,
                error
            );
        }
    }

    return {
        suggestions: suggestions.slice(0, maxResults),
        searchMetadata: metadata,
    };
}
