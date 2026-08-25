import { randomUUID } from "node:crypto";

import { RecipesRepository } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

import { type ComponentTag } from "../../suggestions/services/component-identity";
import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import { generateSuggestionsStream } from "../../suggestions/services/generate-suggestions-stream";
import { streamSingleSuggestion } from "../../suggestions/services/stream-single-suggestion";

import { fetchRecipeSummary } from "./fetch-recipe-summary";
import {
    findCatalogueRecipes,
    resolveIngredientIds,
} from "./find-catalogue-recipes";
import { searchRecipes, searchRecipesByEmbedding } from "./search-recipes";

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
 *
 * No value of this number can protect a NAMED dish, though: a query naming
 * green curry scores higher against Thai Red Curry than a question about palak
 * paneer scores against Palak Paneer itself, so any threshold that accepts the
 * questions above also hands back the wrong sibling for a named dish. That case
 * is guarded by `dish` (see `RecipeSuggestionInput`), which requires a
 * canonical name match — this threshold only arbitrates concept queries, where
 * any relevant dish is a fair answer.
 */
const DEFAULT_MATCH_THRESHOLD = 0.5;

/**
 * Re-exported from `component-identity`, which is where the list now lives so
 * that `suggestions/` can read it without importing this module (that direction
 * is already taken — this file imports several of its services — and closing the
 * loop would make them cyclic).
 *
 * Kept exported HERE because the chat tool's `component` enum imports it from
 * this path, and one vocabulary with one home is the whole point.
 */
export {
    COMPONENT_TAGS,
    type ComponentTag,
} from "../../suggestions/services/component-identity";

export interface RecipeSuggestionInput {
    query: string;
    /**
     * The specific dish the user actually named, when they named one ("Thai
     * Green Curry" for "can I get a thai green curry recipe?"). Absent for
     * concept, cuisine, mood or ingredient queries ("show me an apple
     * dessert"), where any relevant catalogue row is a fair answer.
     *
     * This is what keeps the catalogue stages honest about a named dish.
     * Signature similarity cannot tell "the dish you asked for, phrased
     * differently" from "that dish's nearest sibling": a green-curry query
     * scores well above DEFAULT_MATCH_THRESHOLD against Thai Red Curry,
     * because the two share a cuisine and most of a pantry — and with chat's
     * maxResults of 1 the sibling doesn't merely outrank the answer, it IS
     * the answer, and generation is suppressed. So when `dish` is present, a
     * similarity or ingredient hit only counts if its name (either language)
     * canonically matches the request; anything else falls through to stage
     * 3, whose dedup resolves a same-dish-under-another-name back to the
     * existing row with ingredient-level evidence (`findKnownDish` /
     * `findRecipeForDish`). The failure directions are the asymmetry
     * DEFAULT_MATCH_THRESHOLD's note describes: a false mismatch here costs
     * one generation that dedup then folds back into the existing recipe,
     * while a false match returns the WRONG recipe as if it were what the
     * user asked for.
     */
    dish?: string;
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
    /**
     * How involved a GENERATED dish should be — the model's reading of the
     * request when the user signalled one ("something quick"), otherwise their
     * saved skill level, defaulted in by the caller.
     *
     * Stage 3 only. The catalogue stages are left alone deliberately: filtering
     * existing recipes by difficulty would empty the result on a catalogue that
     * skews medium, and a stage that already found a dish answering the question
     * should return it. The hint is about what we WRITE, not about refusing what
     * we already have.
     */
    difficulty?: "easy" | "medium" | "hard";
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
    /**
     * Total minutes, for the time pill beside the difficulty one. Chat renders
     * the same `RecipeCard` as the feed, so a card that arrives without this
     * shows a difficulty pill on its own and reads as a different card.
     */
    totalTimeMinutes?: number | null;
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
    totalTimeMinutes?: number;
    ingredients?: string[];
    tags?: string[];
}

/**
 * The dish as the generator wrote it, handed over the moment it validates and
 * BEFORE it is reviewed, embedded, deduped and inserted.
 *
 * It exists so a caller can start work that needs the dish's WORDS without
 * waiting for the work that produces its ID. Everything after generation —
 * `verifySuggestionAuthenticity`, the signature embedding, `findRecipeForDish`,
 * `searchSimilar`, the insert — is several seconds during which the dish is
 * fully known and nothing downstream is allowed to say so.
 *
 * **It is not a promise that a card will appear.** The review can still drop
 * this dish as unauthentic or out of scope, and dedup can resolve it onto a
 * differently-named catalogue row. A caller that renders from this must be able
 * to survive both — see the note on the summary in `process-chat`.
 */
export interface EarlyDish {
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    totalTimeMinutes?: number | null;
    ingredients: string[];
    tags: string[];
}

/**
 * A query embedding computed BEFORE the tool arguments existed, offered back to
 * stage 1b so it does not have to pay for one.
 *
 * The whole point is that the embedding can be started against the user's raw
 * message while the routing model is still deciding what to search for — those
 * two run concurrently, and by the time the arguments land the vector is usually
 * sitting here already.
 *
 * **`text` is what makes it safe.** The routed `query` is not the raw message:
 * the prompt tells the model to resolve pronouns against the conversation, so
 * "what sauce goes with it?" becomes "sauce for chicken parmesan" — an entirely
 * different vector. Reusing a speculative embedding there would search for the
 * wrong thing, silently and only on follow-ups, which is the worst shape a bug
 * can have. So the text it was computed from travels with it and stage 1b reuses
 * the vector only when the two canonicalise to the same string, which is the
 * common first-turn case and never a pronoun-bearing follow-up.
 */
export interface SpeculativeEmbedding {
    /** The text the vector was computed from. */
    text: string;
    /** Resolves to the vector, or to null if the speculative embedding failed. */
    vector: Promise<number[] | null>;
}

export interface SearchRecipeSuggestionsOptions {
    /**
     * Present for streaming callers (chat). When set, stage 3 generates a SINGLE
     * suggestion and streams its fields out through this callback as they land;
     * when absent, stage 3 falls back to the multi-suggestion JSONL generator.
     */
    onPartialSuggestion?: (partial: PartialRecipeSuggestion) => void;
    /**
     * Fired once, when a generated dish has validated but not yet been
     * persisted. See {@link EarlyDish}.
     */
    onDishReady?: (dish: EarlyDish) => void;
    /** A vector computed ahead of time; see {@link SpeculativeEmbedding}. */
    speculativeEmbedding?: SpeculativeEmbedding;
    /**
     * Called with a one-word name for each stage as it starts, so a streaming
     * caller can say what it is doing. Deliberately a callback rather than a
     * return value: the interesting moments are all mid-flight.
     */
    onStage?: (stage: SearchStage) => void;
    /** Counter sink for instrumentation; see `TurnTimer`. */
    onMetric?: (name: string, value?: number) => void;
}

/** The stages a caller can narrate. `generate` is the only slow one. */
export type SearchStage = "catalogue" | "generate" | "persist";

export interface SearchMetadata {
    vectorSearchHits: number;
    canonicalSearchHits: number;
    newSuggestionsCreated: number;
}

/**
 * Why a search came back with nothing, when the reason is a STATEMENT about the
 * request rather than a fault.
 *
 * - `no_known_dish` — the catalogue held nothing and every dish the generator
 *   wrote was refused by the notability gate. There is no established dish here
 *   under any name.
 * - `not_food` — the request was for a drink. This catalogue holds food.
 *
 * ## Why this exists at all
 *
 * `persistOrReuseSuggestion` has always known both of these and said so in the
 * server log, and this function threw the whole `dropped` outcome away — a
 * refusal and a crash left the caller with the same empty array. Chat then read
 * "the tool was invoked and produced no card" as a broken turn and offered a
 * Regenerate button, which re-ran the identical request. Measured 2026-08-24:
 * four consecutive retries of "brussel sprouts recipe", four generations, four
 * drops, four identical "Something went wrong" toasts.
 *
 * An empty result with no reason attached is still exactly that — a failure, or
 * a request nobody has classified. Absence of this field is not a claim.
 */
export interface SearchUnsatisfied {
    reason: "no_known_dish" | "not_food";
    /** The dish names that were written and refused, for the log and the reply. */
    attempted: string[];
}

export interface RecipeSuggestionResult {
    suggestions: RecipeSuggestionItem[];
    searchMetadata: SearchMetadata;
    /**
     * Set only when the search produced nothing AND knows why. See
     * {@link SearchUnsatisfied} — never set alongside a non-empty
     * `suggestions`.
     */
    unsatisfied?: SearchUnsatisfied;
}

/**
 * Stage 1b's vector search, reusing a speculative embedding when it is safe to.
 *
 * "Safe" is a string comparison and nothing cleverer: the vector must have been
 * computed from text that canonicalises to the same thing as the query we are
 * about to search for. A routed query that differs — which is what a pronoun
 * resolution produces — pays for its own embedding, as it always did.
 *
 * The counters are the point of doing it this narrowly. Reusing the vector for
 * a merely SIMILAR query would very likely be fine and would hit far more often,
 * but "very likely fine" is not something to ship into a recall path on a
 * guess. `search.embedding_reused` against `search.embedding_computed` is the
 * measurement that would justify widening it.
 */
async function runVectorSearch(
    query: string,
    threshold: number,
    limit: number,
    speculative: SpeculativeEmbedding | undefined,
    onMetric: SearchRecipeSuggestionsOptions["onMetric"]
) {
    if (speculative && canonicalizeName(speculative.text) === canonicalizeName(query)) {
        const vector = await speculative.vector;

        if (vector) {
            onMetric?.("search.embedding_reused");

            return searchRecipesByEmbedding(vector, threshold, limit);
        }
    }

    onMetric?.("search.embedding_computed");

    return searchRecipes(query, threshold, limit);
}

/**
 * Stage 2, asking under both names at once.
 *
 * The raw query rarely IS a canonical name ("a thai green curry recipe
 * please"), so the dish name has to be asked for as well — and it used to be
 * asked for only after the first lookup came back empty, which is a second
 * serial round trip to learn something the first one could not have told us.
 * The query's answer still wins when both hit, preserving the original
 * precedence.
 */
async function findCanonicalSuggestion(
    query: string,
    dish: string | undefined,
    isExcluded: (...names: Array<string | null | undefined>) => boolean
) {
    const [byQuery, byDish] = await Promise.all([
        isExcluded(query) ? Promise.resolve(null) : findSuggestionByName(query),
        dish && !isExcluded(dish)
            ? findSuggestionByName(dish)
            : Promise.resolve(null),
    ]);

    return byQuery ?? byDish;
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
        dish,
        matchThreshold = DEFAULT_MATCH_THRESHOLD,
        maxResults = 5,
        ingredients,
        exclude,
        component,
        dietaryRestrictions,
        blacklist,
        difficulty,
    } = input;
    const {
        onPartialSuggestion,
        onDishReady,
        speculativeEmbedding,
        onStage,
        onMetric,
    } = options;

    const excluded = new Set((exclude ?? []).map(canonicalizeName));
    const isExcluded = (...names: Array<string | null | undefined>) =>
        names.some((name) => !!name && excluded.has(canonicalizeName(name)));

    // The names that count as "the dish the user asked for": the dish they
    // named plus the raw query (stage 1a already treats the query as a name).
    // Empty when no dish was named — then any relevant row answers the request
    // and the gate below stays open.
    const requestedNames = new Set(
        (dish ? [dish, query] : [])
            .map(canonicalizeName)
            .filter((name): name is string => !!name)
    );
    const isRequestedDish = (...names: Array<string | null | undefined>) =>
        requestedNames.size === 0 ||
        names.some((name) => {
            const canonical = canonicalizeName(name);
            return !!canonical && requestedNames.has(canonical);
        });

    // No component asked for means no component filter — every row qualifies.
    const wanted = component ? canonicalizeName(component) : null;
    const isWantedComponent = (tags: Array<{ name: string }>) =>
        !wanted || tags.some((tag) => canonicalizeName(tag.name) === wanted);

    const suggestions: RecipeSuggestionItem[] = [];
    /** See {@link SearchUnsatisfied}. Only ever set on the generate path. */
    let unsatisfied: SearchUnsatisfied | undefined;
    const metadata: SearchMetadata = {
        vectorSearchHits: 0,
        canonicalSearchHits: 0,
        newSuggestionsCreated: 0,
    };

    onStage?.("catalogue");

    // Stage 1a: exact name match. Recipes are embedded by dish SIGNATURE
    // (English name + tags + ingredients), which reads nothing like a short
    // foreign proper noun — "Toum" scores 0.239 against its own recipe, "Palak
    // Paneer" 0.524. Vector search cannot be the only way to find a recipe the
    // user named outright, so ask for it by name first — under the dish name as
    // well as the raw query, since "a thai green curry recipe please" matches
    // nothing verbatim while the dish it names is in the catalogue.
    //
    // ## This one stage stays serial, and the rest below do not
    //
    // It is a single indexed lookup on an exact name — tens of milliseconds —
    // and when it hits, it hits with `matchScore: 1` and chat's `maxResults` of
    // 1 means nothing after it can change the answer. Folding it into the fan-out
    // would buy no wall-clock (it is never the long pole) and would make every
    // named-dish request pay for an embedding it currently skips. So the cheap,
    // decisive early-out keeps its place at the front, and the parallelism goes
    // where the seconds actually are.
    const namedRecipe = await new RecipesRepository().findBaseRecipes(
        [query, dish].filter((name): name is string => !!name && !isExcluded(name))
    );

    if (!namedRecipe.success) {
        console.error(
            `[SearchRecipeSuggestions] Name lookup failed for "${query}":`,
            namedRecipe.error.message
        );
    } else if (namedRecipe.value.length > 0) {
        // Oldest match, deliberately not `pickIdentityMatch`. This is a free-text
        // search — the user typed a name and there is no dish whose identity we
        // are establishing, so there is no cuisine to disambiguate on. If a name
        // does carry two dishes, the older is the better default and the vector
        // stages below still surface the other.
        const summary = await fetchRecipeSummary(namedRecipe.value[0].id);

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
                totalTimeMinutes: summary.totalTimeMinutes,
                source: "existing_recipe",
                matchScore: 1,
                ingredients: summary.ingredients,
                tags: summary.tags,
            });
            metadata.vectorSearchHits++;
            onMetric?.("catalogue.named_hit");
        }
    }

    /**
     * The ingredient ids the user actually asked about, resolved once.
     *
     * Used twice and that is the point: `find_recipes` FILTERS on them, and the
     * similarity stage below has to CHECK against them. Resolving separately in
     * each place would be two round trips to the same answer, free to disagree.
     */
    const requestedIngredientIds = ingredients?.length
        ? new Set(await resolveIngredientIds(ingredients))
        : new Set<string>();

    /**
     * Does this row contain something the user named?
     *
     * **Open when no ingredient was named, and a hard gate when one was.** This
     * is `isRequestedDish`'s counterpart for the other kind of request: that one
     * stops a similarity hit impersonating a dish the user NAMED, this one stops
     * it answering an INGREDIENT question with a dish that does not contain the
     * ingredient.
     *
     * Without it, "give me a recipe containing brussels sprouts" sets no `dish`,
     * so `isRequestedDish` stays open, and every recipe clearing the 0.5
     * similarity threshold was accepted — none of which need contain a brussels
     * sprout. Similarity is measured against the dish SIGNATURE, so a request
     * phrased around a vegetable scores respectably against anything vegetable-
     * ish. And because the vector rows are pushed FIRST, on chat's `maxResults`
     * of 1 a loose hit took the single slot that the exact ingredient match
     * (stage 1c) was about to fill.
     */
    const containsRequestedIngredient = (
        rows: Array<{ id: string }>
    ): boolean =>
        requestedIngredientIds.size === 0 ||
        rows.some((row) => requestedIngredientIds.has(row.id));

    // Stages 1b, 1c and 2 all at once.
    //
    // They are three independent reads and they used to run one after another,
    // each behind an early return. The early returns are worth almost nothing —
    // they save database time on the path that already has an answer — while the
    // serial arrangement costs the SUM of all three on a MISS, which is exactly
    // the path that then goes on to spend ten seconds generating. Wrong way
    // round: pay the cheap concurrent cost always, and never make the slow path
    // wait for its own preamble.
    //
    // Precedence is unchanged, because it is applied when the results are
    // assembled below rather than by the order they were issued in.
    if (suggestions.length < maxResults) {
        const [vectorSearch, catalogueRows, canonicalMatch] = await Promise.all([
            // Stage 1b: vector search on recipes.
            runVectorSearch(query, matchThreshold, maxResults, speculativeEmbedding, onMetric),

            // Stage 1c: the catalogue lookup the SEARCH SCREEN uses — filter by
            // ingredient id via `find_recipes`, no similarity involved.
            //
            // Stages 1a and 1b between them only find a dish the user all but
            // named: measured, "what can I make with chicken and rice?" scores
            // 0.429 against even the right recipe, so no similarity gate can
            // accept it without accepting noise too. That question is a filter,
            // not a search, and it is the one the search screen answers well
            // while chat did not answer at all — it generated a new dish over a
            // catalogue that already had one.
            requestedIngredientIds.size
                ? findCatalogueRecipes({
                      ingredientIds: [...requestedIngredientIds],
                      blacklist,
                      limit: maxResults,
                  })
                : Promise.resolve([]),

            // Stage 2: canonical search on the suggestions table, under the raw
            // query AND the named dish. The raw query rarely IS a canonical name
            // ("a thai green curry recipe please"), so both are asked for — and
            // asked for together, since the second used to run only after the
            // first came back empty.
            findCanonicalSuggestion(query, dish, isExcluded),
        ]);

        // Stage 1b results, in the order the vector search ranked them.
        const vectorResults = vectorSearch.filter(
            (result) => !suggestions.some((item) => item.id === result.id)
        );

        // Fetch each hit's summary in parallel (independent reads) rather than
        // one round-trip per result, then assemble in the original ranked order.
        const summaries = await Promise.all(
            vectorResults.map((result) => fetchRecipeSummary(result.id))
        );

        vectorResults.forEach((result, i) => {
            const recipeSummary = summaries[i];

            // `isRequestedDish` is what keeps a similarity hit from impersonating
            // a dish the user named: without it, "thai green curry" clears the
            // threshold against Thai Red Curry and the wrong sibling is returned
            // as the answer. A rejected hit falls through to generation, whose
            // dedup folds a genuinely-same dish back into this very row.
            if (
                recipeSummary &&
                !isExcluded(recipeSummary.name) &&
                isWantedComponent(recipeSummary.tags) &&
                isRequestedDish(recipeSummary.name, recipeSummary.nameEn) &&
                containsRequestedIngredient(recipeSummary.ingredients)
            ) {
                suggestions.push({
                    id: recipeSummary.id,
                    name: recipeSummary.name,
                    description:
                        recipeSummary.shortDescription ||
                        recipeSummary.description,
                    image: recipeSummary.image,
                    difficulty: recipeSummary.difficulty,
                    totalTimeMinutes: recipeSummary.totalTimeMinutes,
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

        // Stage 1c results, deduped against 1a/1b by id.
        if (suggestions.length < maxResults) {
            for (const row of catalogueRows) {
                if (suggestions.some((item) => item.id === row.id)) continue;
                if (isExcluded(row.name)) continue;
                if (!isWantedComponent(row.tags)) continue;
                // Same guard as stage 1b: sharing the requested ingredients does
                // not make a row the dish the user named.
                if (!isRequestedDish(row.name)) continue;

                suggestions.push({
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    image: row.image,
                    difficulty: row.difficulty,
                    totalTimeMinutes: row.totalTimeMinutes,
                    // A `recipe` row is already generated, so the card opens it;
                    // a `suggestion` row still routes to the generate screen.
                    source:
                        row.source === "recipe"
                            ? "existing_recipe"
                            : "suggestion",
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

        // Stage 2 result.
        //
        // Skipped when an earlier stage already returned this dish: a suggestion
        // row can outlive its promotion (nothing deletes it if the user reached
        // the recipe another way), and surfacing both would show the same dish
        // twice — once as a recipe and once as a card offering to generate it
        // again.
        const existingSuggestion = canonicalMatch;
        const alreadyListed =
            !!existingSuggestion &&
            (isExcluded(existingSuggestion.name, existingSuggestion.nameEn) ||
                !isWantedComponent(existingSuggestion.tags) ||
                suggestions.some(
                    (item) =>
                        // By id as well as by name: stage 1c can surface this
                        // very suggestion row via find_recipes, and a name
                        // comparison alone would miss it if the two spellings
                        // ever diverged.
                        item.id === existingSuggestion.id ||
                        canonicalizeName(item.name) ===
                            canonicalizeName(existingSuggestion.name) ||
                        canonicalizeName(item.name) ===
                            canonicalizeName(existingSuggestion.nameEn)
                ));

        if (
            existingSuggestion &&
            !alreadyListed &&
            suggestions.length < maxResults
        ) {
            suggestions.push({
                id: existingSuggestion.id,
                name: existingSuggestion.name,
                description: existingSuggestion.description,
                difficulty: existingSuggestion.difficulty,
                totalTimeMinutes: existingSuggestion.totalTimeMinutes,
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
    }

    // If the catalogue answered, return without generating.
    if (suggestions.length >= maxResults) {
        onMetric?.("catalogue.answered");

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

        onStage?.("generate");

        try {
            if (onPartialSuggestion) {
                // Streaming caller (chat): generate ONE suggestion and stream
                // its fields out — title first, then description, etc. — sharing
                // a tempId so the enriched item below upgrades the same card.
                //
                // A named dish is PINNED, not passed as an ingredient. The
                // generator does read the "Ingredients" line as a dish name when
                // it looks like one — but "looks like one" is a guess, and it
                // resolves the wrong way for every dish that is also an
                // ingredient of something else. When no dish was named the raw
                // query is all there is, and it is the concept query that line
                // was written for.
                const tempId = randomUUID();

                // Every distinct title the generator wrote this turn. On the
                // happy path it is one; on a retried notability drop it is the
                // rejected name and then the replacement, and if NOTHING clears
                // the gate it is what `unsatisfied.attempted` reports.
                const attempted: string[] = [];

                const outcome = await streamSingleSuggestion(
                    {
                        // ONLY when no dish was named. A named dish goes in as a
                        // dish (below) — putting it here renders `Ingredients:
                        // Ragu`, and a ragù really is an ingredient of other
                        // dishes, so the generator answered with the plate built
                        // on it. See `StreamSingleSuggestionOptions.dish`.
                        ingredients: dish ? [] : [query],
                        component,
                        dietaryRestrictions,
                        blacklist,
                        difficulty,
                    },
                    {
                        dish,
                        onField: (fields) => {
                            // `name` streams first; hold the frame until it lands
                            // so the card never renders without a title.
                            if (!fields.name) return;
                            if (!attempted.includes(fields.name)) {
                                attempted.push(fields.name);
                            }
                            onPartialSuggestion({
                                tempId,
                                source: "new_suggestion",
                                name: fields.name,
                                description: fields.description,
                                difficulty: fields.difficulty,
                                totalTimeMinutes: fields.totalTimeMinutes,
                                ingredients: fields.ingredients,
                                tags: fields.tags,
                            });
                        },
                        // The generator has finished writing and the dish has
                        // validated; everything from here to an id is review,
                        // embedding, dedup and insert. Hand the words over now
                        // so a caller can get on with the work that only needs
                        // words — see `EarlyDish`.
                        onDishReviewed: (parsed) => {
                            onStage?.("persist");
                            onDishReady?.({
                                name: parsed.name,
                                description: parsed.description,
                                difficulty: parsed.difficulty,
                                totalTimeMinutes: parsed.total_time_minutes,
                                ingredients: parsed.ingredients,
                                tags: parsed.tags,
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
                        totalTimeMinutes: enriched.totalTimeMinutes,
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

                    // The caller's own filters, which this path was missing —
                    // three routes return an existing recipe and only two of
                    // them applied these.
                    //
                    // **Deliberately NOT `isRequestedDish` here**, unlike stages
                    // 1b and 1c. Those match by similarity or by ingredient, so
                    // a name check is what stops a lookalike impersonating the
                    // dish that was asked for. This row was chosen by DEDUP,
                    // whose entire job is to decide that two DIFFERENT names are
                    // one dish — Som Tam and Green Papaya Salad, Bechamel and
                    // "Béchamel Sauce". Requiring the name to match the user's
                    // phrasing here refuses dedup's correct answers: measured, a
                    // request for "Bechamel" generated "Béchamel Sauce",
                    // resolved onto the catalogue recipe of that exact name, and
                    // was thrown away for not being spelled the way the user
                    // typed it.
                    //
                    // What protects the Ragu-returning-Lasagna case is
                    // `componentsDisagree`, at the source, where the tags can
                    // actually settle it.
                    if (isExcluded(recipe.name) || !isWantedComponent(recipe.tags)) {
                        console.warn(
                            `[SearchRecipeSuggestions] Refusing "${recipe.name}" for "${dish ?? query}" — excluded, or not the component asked for`
                        );
                        unsatisfied = { reason: "no_known_dish", attempted };
                        onMetric?.("search.dedup_mismatch");

                        return {
                            suggestions: [],
                            searchMetadata: metadata,
                            unsatisfied,
                        };
                    }

                    suggestions.push({
                        id: recipe.id,
                        name: recipe.name,
                        description:
                            recipe.shortDescription || recipe.description,
                        image: recipe.image,
                        difficulty: recipe.difficulty,
                        totalTimeMinutes: recipe.totalTimeMinutes,
                        source: "existing_recipe",
                        tempId,
                        ingredients: recipe.ingredients,
                        tags: recipe.tags,
                    });
                    metadata.vectorSearchHits++;
                } else if (outcome.kind === "dropped") {
                    // The generation is over and produced no card. Say WHY, so
                    // the caller can answer the question instead of reporting a
                    // fault — see `SearchUnsatisfied`. `not_food` and
                    // `unauthentic` are the two verdicts about the REQUEST; a
                    // `persist_failed` / `invalid` / `duplicate` drop is a fault
                    // or an accident and deliberately says nothing, so the
                    // caller keeps treating it as one.
                    if (outcome.reason === "not_food") {
                        unsatisfied = { reason: "not_food", attempted };
                    } else if (outcome.reason === "unauthentic") {
                        unsatisfied = { reason: "no_known_dish", attempted };
                    }

                    if (unsatisfied) {
                        console.log(
                            `[SearchRecipeSuggestions] Nothing to offer for "${query}" (${unsatisfied.reason}${attempted.length ? `; tried ${attempted.join(", ")}` : ""})`
                        );
                        onMetric?.(`search.unsatisfied.${unsatisfied.reason}`);
                    }
                }
            } else {
                // Non-streaming caller: keep the multi-suggestion JSONL generator.
                let generatedCount = 0;
                const stream = generateSuggestionsStream({
                    ingredients: [dish ?? query],
                    component,
                    dietaryRestrictions,
                    blacklist,
                    difficulty,
                });

                for await (const suggestion of stream) {
                    if (generatedCount >= maxResults) {
                        break;
                    }

                    // The generator emits each dish twice — a provisional card
                    // the moment the model writes it, then the persisted one.
                    // This caller returns rows the chat UI links to, so it needs
                    // the id and skips the provisional frame; the streaming
                    // caller above is the one that benefits from it.
                    if (!("id" in suggestion)) continue;

                    suggestions.push({
                        id: suggestion.id,
                        name: suggestion.name,
                        description: suggestion.description,
                        difficulty: suggestion.difficulty,
                        totalTimeMinutes: suggestion.totalTimeMinutes,
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
        unsatisfied,
    };
}
