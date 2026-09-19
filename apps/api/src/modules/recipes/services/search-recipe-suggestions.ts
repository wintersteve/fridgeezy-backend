import { randomUUID } from "node:crypto";

import { RecipesRepository } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

import { type ComponentTag } from "../../suggestions/services/component-identity";
import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import { generateSuggestionsStream } from "../../suggestions/services/generate-suggestions-stream";
import { streamSingleSuggestion } from "../../suggestions/services/stream-single-suggestion";

import { resolveCuisineFilter } from "./cuisine-filter";
import {
    qualifyingRecipeIds,
    qualifyingSuggestionIds,
    resolveDietaryFilter,
} from "./dietary-filter";
import { fetchRecipeSummary } from "./fetch-recipe-summary";
import {
    findCatalogueRecipes,
    findDishesUsingComponents,
    findPairingsForDish,
    resolveComponents,
    resolveIngredientIds,
    type ResolvedComponent,
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
     * The reader is turning down what they were just shown — "something else",
     * "no, not that one", "anything but the lasagne".
     *
     * It exists because the argument set cannot otherwise tell a refusal apart
     * from a follow-up: both arrive as a pinned `dish` that is ALSO in
     * `exclude`, and the two want opposite resolutions. See the note on
     * `pinRefused` in the body. Absent means "not a refusal", which is the
     * behaviour that shipped before this field.
     */
    refusing?: boolean;
    /**
     * The dish this request is ABOUT but must never return — the anchor of a
     * "what goes well with X" or "what sauce goes with X" request.
     *
     * ## It is excluded HERE, by construction, and that is the whole point
     *
     * The rule "a request for something RELATED to a dish is never answered with
     * that dish" has now been broken twice, by two different routes, and both
     * times the protection was an instruction the router had to remember:
     *
     * - `component` accompaniments relied on the model writing the accompanied
     *   dish into `exclude`. When it did, the search worked.
     * - "What goes well with Korean chicken?" routed with an EMPTY `exclude`,
     *   nothing refused the anchor, and stage 1b's vector search scored Korean
     *   Fried Chicken 0.602 — top hit, single slot, the dish returned as the
     *   answer to a question about it.
     *
     * A third instruction would fail a third way. Naming the anchor in its own
     * field lets the search exclude it whether or not the model also said so,
     * which makes the guarantee a property of the code rather than of a prompt.
     *
     * It is folded into the exclusion set below, so it reaches every catalogue
     * stage AND the generator through one path — the same list, not a second
     * rule that could disagree with it.
     */
    pairsWith?: string;
    /**
     * Which slot on the table a `pairsWith` request wants filled.
     *
     * Deliberately separate from {@link component}, which is a BUILDING BLOCK
     * vocabulary (sauce, dough, roux) and contains no course at all. Before this
     * existed the router reached for `component: "side"` — a value not in
     * `COMPONENT_TAGS`, which flowed through unvalidated, matched the course tag
     * by name and half-worked, while telling the generator to write a component
     * of a kind it has never heard of.
     */
    course?: "appetizer" | "side" | "dessert";
    /**
     * The cuisine or region the dish must belong to — "Thai", "Asian",
     * "Middle Eastern".
     *
     * A REGION expands to its descendants and a specific cuisine does not; see
     * `resolveCuisineFilter`. Absent means no cuisine filter at all, which is
     * most turns.
     */
    cuisine?: string[];
    /**
     * The most time the cook has, TOTAL, in whole minutes. A CEILING.
     *
     * Deliberately a number rather than a coarse band. Bands are a product
     * statement about what a weeknight allows (`quick` was anything up to 30
     * minutes), and mapping "I've got 20 minutes" onto `quick` would WIDEN it
     * — a 28-minute dish would qualify for a 20-minute
     * request. A ceiling cannot widen.
     */
    maxMinutes?: number;
    /**
     * The component type the user actually asked for ("sauce", "marinade"). Set
     * only for component questions; when present, every catalogue stage keeps
     * just the rows carrying that component tag and stage 3 is told to generate
     * one. This is what stops "what sauce goes with apple strudel" from being
     * answered with Apple Strudel — the exclusion above only covers dishes we
     * can name up front.
     */
    component?: ComponentTag;
    /**
     * Dietary tag NAMES ("vegan", "gluten free") the answer must satisfy —
     * whether it is generated or retrieved.
     *
     * It used to bind only what was GENERATED, which made it almost inert:
     * every stage above 3 returns a dish the catalogue already holds, and
     * retrieval wins by design, so the dish the model would have written was
     * vegan and the dish the reader got was Carbonara. Now resolved once (see
     * `resolveDietaryFilter`) and applied to every stage.
     *
     * Names rather than tag ids because that is what the client has: it reads
     * `profile_dietary_preferences` joined to `tags` and sends `tag.name`, and
     * every generator prompt downstream needs the name anyway — a uuid means
     * nothing to a model.
     */
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
    /**
     * `type` is what the client's `groupRecipeTags` derives a card's eyebrow
     * from, so without it a chat card draws `IDEA` and nothing else where the
     * same `IdeaTicket` in search draws `IDEA · THAI · NOODLES`. Every source
     * feeding this already had it — `find_recipes`' aggregate,
     * `toNamedRows`, `fetchEnrichedSuggestion` — and it was dropped here and
     * in the four `.map()`s below, each of which rebuilt `{ id, name }` off a
     * source that had it. The two on the `new_suggestion` paths are the ones
     * the chat tab actually hit.
     *
     * Optional, because the one source that genuinely cannot supply it is the
     * partial frame: those tags are the model's own strings, emitted before
     * anything has been matched to a `tags` row.
     */
    tags: Array<{ id: string; name: string; type?: string }>;
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
        // Renamed on the way in: the pin that APPLIES to this search is derived
        // below, because a caller that is refusing the pinned dish gets it
        // dropped. Everything downstream reads the derived `dish`.
        dish: requestedDish,
        matchThreshold = DEFAULT_MATCH_THRESHOLD,
        maxResults = 5,
        ingredients,
        exclude,
        refusing,
        pairsWith,
        course,
        cuisine,
        maxMinutes,
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

    /**
     * The dish the caller pinned can never also be a dish it refuses.
     *
     * **This is not defensive tidying — it is the one shape that makes the whole
     * search unsatisfiable by construction.** `isRequestedDish` below admits
     * only rows named `dish`; `isExcluded` refuses any row named in `exclude`.
     * With the same name in both, every catalogue stage rejects every row, and
     * generation — pinned to that dish by its `Dish:` line — has its own output
     * rejected too. The turn ends `unsatisfied` with nothing to show and nothing
     * in the log to say why.
     *
     * It arrives from the chat router, which is told to pin a named dish AND to
     * exclude every dish it has already shown. Those two rules are both right on
     * their own and collide on a follow-up about the dish on screen: measured
     * 2026-09-03, "What if we add cheese to it?" after a Béchamel card routed to
     * `dish: "Béchamel", exclude: ["Béchamel"]` and could not have returned
     * anything.
     *
     * ## Which side wins is now a question the CALLER answers
     *
     * The collision has two causes that look identical here and mean opposite
     * things, and until `refusing` existed only one of them could be served:
     *
     * - **"tell me more about that dish"** — the reader is asking ABOUT the card
     *   on screen. The dish is on screen, so it is in the exclusions; the pin is
     *   what the turn is for. **The pin wins.** This is the 2026-09-03 case.
     * - **"no, something else"** — the reader is REFUSING the card on screen.
     *   The router still pins it, because it is what the conversation is about,
     *   and the collision is the same shape. **The exclusion wins**, and the pin
     *   is dropped for this turn so the search and the generator are free to find
     *   something that is not it.
     *
     * Nothing in the arguments distinguishes those two, which is why the router
     * is asked to say so directly (`refusing`) rather than having this infer it
     * from a sentence it never sees. With `refusing` unset — an older client, a
     * model that did not fill it in — the behaviour is exactly what it was, so
     * the earlier fix cannot be undone by this one.
     *
     * The collision also became far more COMMON in the same change that made it
     * resolvable: `shownDishes` sends the complete list of cards on screen, and
     * the dish a follow-up is about is by definition one of them.
     */
    const pinnedName = canonicalizeName(requestedDish);
    const contradicted = (exclude ?? []).filter(
        (name) => !!pinnedName && canonicalizeName(name) === pinnedName
    );

    /**
     * The reader refused the pinned dish, so the pin is dropped rather than the
     * exclusion.
     *
     * Only when the two actually collide. `refusing` on its own says nothing
     * about the pin — "something other than lasagne, but make it a béchamel
     * gratin" is a refusal AND a legitimate new pin, and dropping that pin would
     * throw away the half of the request the reader was most specific about.
     */
    const pinRefused = !!refusing && contradicted.length > 0;

    if (contradicted.length > 0) {
        console.warn(
            pinRefused
                ? `[SearchRecipeSuggestions] Dropping the pin on "${requestedDish}" — the caller is refusing it (exclude names it, refusing=true)`
                : `[SearchRecipeSuggestions] Ignoring exclude ${JSON.stringify(contradicted)} — it names the pinned dish "${requestedDish}"`
        );
        onMetric?.(
            pinRefused ? "search.pin_refused" : "search.exclude_contradicted_dish"
        );
    }

    /**
     * The pin as it applies to THIS search.
     *
     * Everything below reads this rather than the raw argument, so unpinning is
     * one decision made once: `isRequestedDish` reopens, stage 1a and stage 2
     * stop asking for the dish by name, and — the half that matters most —
     * `streamSingleSuggestion` gets no `Dish:` line, so the generator is free to
     * answer with something the reader has not already turned down.
     */
    const dish = pinRefused ? undefined : requestedDish;

    /**
     * The exclusions that SURVIVED the contradiction check, as the caller spelled
     * them.
     *
     * Kept as display names, not just as the canonical set below, because they
     * are now sent to the GENERATOR as well as used to filter rows — and a
     * generator prompt cannot use `b_chamel`. Deriving both from one list is what
     * stops the two layers disagreeing about which exclusions are in force: a
     * dish the catalogue stages are told to ignore must not be a dish the
     * generator is told to avoid, and vice versa.
     */
    /**
     * The anchor joins the exclusions, here rather than in the prompt.
     *
     * Appended rather than merged into `exclude` upstream so there is exactly
     * one list in force from this line down: the catalogue stages read it
     * through `isExcluded`, the generator is handed the same names, and neither
     * can be told something the other was not. A caller that also listed the
     * anchor in `exclude` costs nothing — the set below deduplicates.
     *
     * It is NOT subject to the `refusing` tiebreak or the pin contradiction
     * check: those arbitrate between a dish the caller ASKED FOR and one it
     * refused, and an anchor was never asked for. A request naming the same dish
     * in `dish` and `pairsWith` is incoherent rather than ambiguous, and
     * excluding it is the safe reading.
     */
    const excludedNames = [
        ...(exclude ?? []).filter(
            (name) => !pinnedName || canonicalizeName(name) !== pinnedName
        ),
        ...(pairsWith ? [pairsWith] : []),
    ];

    const excluded = new Set(
        excludedNames.map(canonicalizeName).filter((name): name is string => !!name)
    );
    const isExcluded = (...names: Array<string | null | undefined>) =>
        names.some((name) => {
            const canonical = canonicalizeName(name);

            return !!canonical && excluded.has(canonical);
        });

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

    /**
     * Does this row fill the COURSE slot the reader asked for?
     *
     * Found by `assertSearchFieldsAreGated` on 2026-09-14, which is what that
     * assertion is for: `course` reached the pairing retrieval and the generator
     * and **nothing else**. So "what side goes with lasagne" could be answered
     * from stage 1b with a main, because similarity does not know what a course
     * is and no gate here said otherwise.
     *
     * Open when no course was asked for — which is most turns, including an open
     * "what goes well with this", where a starter, a side or a pudding are all
     * fair answers.
     */
    const wantedCourse = course ? canonicalizeName(course) : null;
    const isWantedCourse = (tags: Array<{ name: string }>) =>
        !wantedCourse ||
        tags.some((tag) => canonicalizeName(tag.name) === wantedCourse);

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
    //
    // The diet is resolved alongside it rather than before it: the two are
    // independent reads and stage 1a is the one on the critical path, so making
    // it wait for a vocabulary lookup would add latency to the one stage whose
    // whole justification is that it is decisive and cheap.
    // The two ingredient resolutions ride along for the same reason the diet
    // does: they are independent indexed reads, every later stage needs them,
    // and issuing them here costs nothing beyond what the slowest of the group
    // already costs. Stage 1a's own gate reads the component half, so they
    // cannot be deferred past it in any case.
    const [
        namedRecipe,
        dietFilter,
        resolvedIngredientIds,
        requestedComponents,
        resolvedBlacklistIds,
        cuisineFilter,
    ] = await Promise.all([
            new RecipesRepository().findBaseRecipes(
                [query, dish].filter(
                    (name): name is string => !!name && !isExcluded(name)
                )
            ),
            resolveDietaryFilter(dietaryRestrictions),
            ingredients?.length
                ? resolveIngredientIds(ingredients)
                : Promise.resolve([] as string[]),
            ingredients?.length
                ? resolveComponents(ingredients)
                : Promise.resolve([] as ResolvedComponent[]),
            // The reader's allergies and dislikes, as ids — see `isBlacklisted`.
            blacklist?.length
                ? resolveIngredientIds(blacklist)
                : Promise.resolve([] as string[]),
            resolveCuisineFilter(cuisine),
        ]);

    /**
     * Does this row contain something the reader will not eat?
     *
     * **This gate did not exist until 2026-09-14, and its absence was the most
     * serious thing `assertSearchFieldsAreGated` turned up.** `blacklist` was
     * threaded into stage 1c, 1d, 1e and both generators — every path that
     * filters in SQL or writes a prompt — and into no push site at all. So the
     * three stages that read tables directly (1a exact name, 1b similarity, 2
     * canonical suggestion) could return a dish containing an ingredient the
     * reader had said they cannot eat, and nothing anywhere would notice.
     *
     * It is the same shape as `suitsDiet` and sits beside it, but the two are
     * not interchangeable: a diet is a property of the DISH derived from every
     * ingredient's classification, while this is a named list of specific
     * ingredient rows. A dish can be perfectly vegan and still contain the one
     * nut somebody is allergic to.
     *
     * Matching is by ingredient ID on both sides, never substring — the rule
     * `decideReuse` already states for the promote path, and for the same
     * reason: "Butter" must not match "butternut squash".
     *
     * **Identity closure is deliberately NOT applied here**, unlike
     * `find_recipes`, and that is a known narrowing rather than an oversight:
     * `resolveIngredientIds` resolves canonical ids and aliases but does not
     * expand an id over `ingredient_identity_ids`. A reader who blacklisted
     * "Ground Pork" is protected from that row and not from "Minced Pork". The
     * SQL stages get the closure for free; these three do not, and closing it
     * needs the id-expansion helper reachable from TypeScript. Recorded rather
     * than silently accepted.
     */
    /**
     * Does this row belong to the cuisine the reader asked for?
     *
     * Open when none was asked for. When one was, the row must carry a tag from
     * the SUBTREE — so "Asian" admits a Thai dish and "Thai" admits only Thai.
     *
     * **Fails closed on an unresolvable term**, which is why the count is
     * compared rather than the set merely being non-empty: "an Ethiopian dish"
     * against a vocabulary with no Ethiopian tag must return nothing from the
     * catalogue and fall through to generation, where the word reaches the
     * prompt. Quietly dropping it would answer with any dish at all, which is
     * the exact failure this field was added for.
     */
    const isWantedCuisine = (tags: Array<{ id: string }>): boolean => {
        if (!cuisineFilter) return true;
        if (cuisineFilter.rootIds.length < cuisineFilter.requestedCount) {
            return false;
        }

        return tags.some((tag) => cuisineFilter.subtreeIds.has(tag.id));
    };

    /**
     * Does this dish fit in the time the reader has?
     *
     * Open when no ceiling was asked for. When one was, **a row with no recorded
     * time is REFUSED** — the same fail-closed rule `recipe_dietary` applies to
     * an unclassified ingredient, and for the same reason: "we do not know how
     * long this takes" is not evidence that it fits in twenty minutes. The cost
     * is near zero (44 of 45 recipes and 37 of 37 suggestions carry a total) and
     * the alternative is telling somebody with half an hour to start a braise.
     *
     * A ceiling, never a band. See `RecipeSuggestionInput.maxMinutes`.
     */
    const withinTime = (totalTimeMinutes: number | null | undefined): boolean =>
        maxMinutes === undefined ||
        (typeof totalTimeMinutes === "number" &&
            totalTimeMinutes > 0 &&
            totalTimeMinutes <= maxMinutes);

    const blacklistedIds = new Set(resolvedBlacklistIds);
    const isBlacklisted = (rows: Array<{ id: string }>): boolean =>
        blacklistedIds.size > 0 &&
        rows.some((row) => blacklistedIds.has(row.id));

    const requestedComponentIds = new Set(
        requestedComponents.map((component) => component.id)
    );

    /**
     * Is this row the COMPONENT ITSELF, rather than a dish built on it?
     *
     * The mirror image of the rule the router already enforces on the way in —
     * "a building block is never answered with a dish that contains it" — and it
     * has to exist here because the inverse fails the same way, silently and by
     * similarity. Measured 2026-09-13 against the local catalogue: a search for
     * "recipe with Béchamel" had stage 1b score the **Béchamel Sauce recipe**
     * highest and push it first, which at chat's `maxResults` of 1 took the only
     * slot — so the reader asked for a dish USING a béchamel and was handed the
     * béchamel, with four correct answers sitting behind it in stage 1d.
     *
     * The same shape as `containsRequestedIngredient`'s note: the vector rows are
     * pushed FIRST, so a loose hit takes the slot an exact match was about to
     * fill. Open when no component was named.
     *
     * Both keys are checked because a component answers to two names — the one a
     * recipe lists it by (`Bechamel Sauce`) and the one a cook asks for
     * (`Béchamel`) — and the catalogue may hold a recipe under either.
     */
    const requestedComponentNames = new Set(
        requestedComponents
            .flatMap((component) => [
                component.canonicalId,
                component.dishCanonicalId,
            ])
            .filter((name): name is string => !!name)
    );

    const isTheRequestedComponent = (
        ...names: Array<string | null | undefined>
    ): boolean =>
        requestedComponentNames.size > 0 &&
        names.some((name) => {
            const canonical = canonicalizeName(name);

            return !!canonical && requestedComponentNames.has(canonical);
        });

    /**
     * How many restrictions were ASKED for, counted off the raw argument rather
     * than off what resolved — the same construction `find_recipes` uses for
     * `requested_tag_count`, and for the same reason. A name that resolves to
     * no tag has to make the filter unsatisfiable rather than being quietly
     * ignored; for a restriction, failing closed is the only safe direction.
     */
    const requestedDietCount = new Set(
        (dietaryRestrictions ?? [])
            .map(canonicalizeName)
            .filter((name): name is string => !!name)
    ).size;

    /**
     * Does this catalogue row suit the reader's diet?
     *
     * Open when no diet was set, and a hard gate when one was — the same shape
     * as `isRequestedDish` and `containsRequestedIngredient` above, and applied
     * at the same three push sites. Stage 1c is deliberately absent from the
     * list: `find_recipes` applies the diet in SQL, so a second test here would
     * be a duplicate of a rule that only works if both copies agree.
     *
     * Membership is precomputed per stage rather than awaited per row, so a
     * stage costs one round trip however many candidates it produced.
     */
    const suitsDiet = (
        qualifying: Set<string> | null,
        id: string
    ): boolean => !dietFilter || (qualifying?.has(id) ?? false);

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

        // One candidate, so this is one round trip and only when a diet is set.
        const namedQualifies = dietFilter
            ? await qualifyingRecipeIds(
                  [namedRecipe.value[0].id],
                  dietFilter,
                  requestedDietCount
              )
            : null;

        if (
            summary &&
            !isExcluded(summary.name) &&
            isWantedComponent(summary.tags) &&
            isWantedCourse(summary.tags) &&
            isWantedCuisine(summary.tags) &&
            withinTime(summary.totalTimeMinutes) &&
            !isBlacklisted(summary.ingredients) &&
            // A request for a dish USING this component is not answered with
            // the component — see `isTheRequestedComponent`.
            !isTheRequestedComponent(summary.name) &&
            // A dish the reader NAMED is still refused when it does not suit
            // their diet, and that is deliberate. This is a feed request, not a
            // reference lookup: chat answers it by COOKING something, so
            // handing back a dish they have said they cannot eat is not
            // "showing them the recipe they asked for", it is the one outcome
            // the restriction exists to prevent. The catalogue search screen
            // takes the opposite side on the same question, and its own note
            // says why — there, a name search has one row that IS the answer.
            suitsDiet(namedQualifies, summary.id)
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
    /**
     * The same names, resolved a SECOND way: as components.
     *
     * "Béchamel" is an ingredient question and a component question at once, and
     * the two resolve through different columns — `canonical_id` is
     * `bechamel_sauce` while what the reader typed canonicalises to `bechamel`,
     * which only `component_dish_canonical_id` holds. Measured 2026-09-13,
     * `resolveIngredientIds(["béchamel"])` returned nothing at all, so stage 1c
     * was skipped rather than answering.
     *
     * Both lookups run because a name can legitimately be neither, either or
     * both: "chicken" is only an ingredient, "béchamel" only a component, and
     * "tomato sauce" is a row that is both. Two cheap indexed reads, issued
     * together.
     */
    const requestedIngredientIds = new Set(resolvedIngredientIds);

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
        const [
            vectorSearch,
            catalogueRows,
            componentRows,
            pairingRows,
            canonicalMatch,
        ] = await Promise.all([
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
                      // Filtered in SQL by the RPC itself, so this stage needs
                      // no post-filter below. Empty when nothing resolved,
                      // which is the fail-closed case and is why the guard
                      // beneath refuses the whole stage rather than trusting an
                      // unfiltered result.
                      // Diet AND cuisine: `find_recipes` takes one generic tag
                      // array and expands each entry through `tag_subtree`, so
                      // the ROOTS go in — handing it the 53-tag Asian expansion
                      // would make it demand a row satisfy all 53.
                      dietaryTagIds: [
                          ...(dietFilter?.tagIds ?? []),
                          ...(cuisineFilter?.rootIds ?? []),
                      ],
                      limit: maxResults,
                  })
                : Promise.resolve([]),

            // Stage 1d: dishes BUILT ON a named component — "a recipe with
            // béchamel".
            //
            // The stage the catalogue had no answer for at all. 1c filters by
            // ingredient ID, and a recipe does not LIST its béchamel: it lists
            // the butter, flour and milk, so `recipe_ingredients` where
            // `ingredient_id = <Bechamel Sauce>` returned zero rows on a
            // catalogue holding four dishes built on one. This reads
            // `dish_components` instead — the explicit declarations plus the
            // ingredient rows that ARE components — so both halves answer.
            //
            // Runs alongside the others rather than after, for the reason the
            // whole fan-out exists: on the path where nothing is found, the
            // serial arrangement charges the sum of every stage to the request
            // that then spends ten seconds generating.
            requestedComponentIds.size
                ? findDishesUsingComponents({
                      componentIds: [...requestedComponentIds],
                      blacklist,
                      // Applied in SQL by the RPC, like stage 1c — and guarded
                      // by the same `dietResolved` test below, since a
                      // restriction that resolved to no tag reaches it as an
                      // empty array and reads as "no filter".
                      dietaryTagIds: dietFilter?.tagIds,
                      // Over-fetched by however many exclusions are in force,
                      // because the exclusions are applied HERE by name and the
                      // limit is applied THERE by the database. At chat's
                      // `maxResults` of 1 the two together are fatal: the RPC
                      // returns exactly one row, the loop below excludes it, and
                      // a stage holding four more correct answers contributes
                      // nothing. Measured — refusing the first dish built on a
                      // béchamel sent the turn to the generator over a catalogue
                      // holding three more.
                      limit: maxResults + excluded.size,
                  })
                : Promise.resolve([]),

            // Stage 1e: dishes people have actually served BESIDE the anchor.
            //
            // The same retrieval the compose screen runs before it generates, so
            // "what goes well with the chicken" and "Serve it with…" agree. It
            // is ranked by how many saved menus hold the pairing, which means it
            // answers only as well as that corpus has been filled — and today it
            // is empty (0 menus on the live project), so this returns nothing
            // essentially always and the turn goes on to generate. That is the
            // designed behaviour, not a degraded one: the value accrues as
            // people compose, until the common pairing stops costing a call.
            pairsWith
                ? findPairingsForDish({
                      dishName: pairsWith,
                      courses: course ? [course] : undefined,
                      // The anchor is already in here — see `excludedNames`.
                      exclude: excludedNames,
                      blacklist,
                      dietaryRestrictions,
                      limit: maxResults + excluded.size,
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

        /**
         * The diet, asked once for everything stages 1b and 2 turned up.
         *
         * Both read their tables directly rather than through `find_recipes`,
         * so neither gets the RPC's dietary handling for free. Batching them
         * together costs two round trips for the whole fan-out (one per table)
         * instead of one per candidate, and it runs alongside the summary fetch
         * rather than after it — the two are independent.
         *
         * `find_recipes` is what settles the semantics, not this: `derivable`
         * diets are answered from `recipe_dietary` (i.e. from the ingredients,
         * failing closed on an unclassified one) and the eight that have no
         * rule from the tags the row carries. See `dietary-filter.ts`.
         */
        const [summaries, vectorQualifies, suggestionQualifies] =
            await Promise.all([
                // Fetch each hit's summary in parallel (independent reads)
                // rather than one round-trip per result, then assemble in the
                // original ranked order.
                Promise.all(
                    vectorResults.map((result) => fetchRecipeSummary(result.id))
                ),
                dietFilter
                    ? qualifyingRecipeIds(
                          vectorResults.map((result) => result.id),
                          dietFilter,
                          requestedDietCount
                      )
                    : Promise.resolve(null),
                dietFilter && canonicalMatch
                    ? qualifyingSuggestionIds(
                          [canonicalMatch.id],
                          dietFilter,
                          requestedDietCount
                      )
                    : Promise.resolve(null),
            ]);

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
                isWantedCourse(recipeSummary.tags) &&
                isWantedCuisine(recipeSummary.tags) &&
                withinTime(recipeSummary.totalTimeMinutes) &&
                !isBlacklisted(recipeSummary.ingredients) &&
                isRequestedDish(recipeSummary.name, recipeSummary.nameEn) &&
                !isTheRequestedComponent(
                    recipeSummary.name,
                    recipeSummary.nameEn
                ) &&
                containsRequestedIngredient(recipeSummary.ingredients) &&
                suitsDiet(vectorQualifies, recipeSummary.id)
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
                        type: tag.type,
                    })),
                });
                metadata.vectorSearchHits++;
            }
        });

        // Stage 1c results, deduped against 1a/1b by id.
        //
        // No diet test in the loop — `find_recipes` applied it. The one thing
        // that has to be checked here is that it COULD: a restriction that
        // resolved to no tag reaches the RPC as an empty `tags` array, which
        // reads as "no filter" rather than as "impossible", so the rows came
        // back unfiltered. Refuse the whole stage in that case and let
        // generation answer, where the restriction is honoured in the prompt.
        const dietResolved =
            !dietFilter || dietFilter.tagIds.length >= requestedDietCount;

        if (suggestions.length < maxResults && dietResolved) {
            for (const row of catalogueRows) {
                if (suggestions.some((item) => item.id === row.id)) continue;
                if (isExcluded(row.name)) continue;
                if (!isWantedComponent(row.tags)) continue;
                // Same guard as stage 1b: sharing the requested ingredients does
                // not make a row the dish the user named.
                if (!isRequestedDish(row.name)) continue;
                if (isTheRequestedComponent(row.name)) continue;
                // `find_recipes` applies the blacklist AND the cuisine in SQL
                // (its `tags` array is subtree-expanded); it knows nothing
                // about courses.
                if (!isWantedCourse(row.tags)) continue;
                if (!withinTime(row.totalTimeMinutes)) continue;

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

        // Stage 1d results: dishes built on the named component.
        //
        // Gated exactly like 1c, with one deliberate omission —
        // `containsRequestedIngredient` is NOT applied. That gate asks whether
        // the row's INGREDIENT LIST holds what was requested, and the whole
        // point of this stage is the dishes where it does not: Moussaka is built
        // on a béchamel and lists butter, flour and milk. Applying it here would
        // refuse every row this stage exists to find.
        //
        // `isRequestedDish` is applied, and stays open in practice: a component
        // request sets no `dish` (the router puts the component in
        // `ingredients`), so the gate admits everything. It is kept rather than
        // dropped because a caller that DOES pin a dish and name a component
        // means both, and this stage should not be the one that ignores the pin.
        if (suggestions.length < maxResults && dietResolved) {
            for (const row of componentRows) {
                if (suggestions.some((item) => item.id === row.id)) continue;
                if (isExcluded(row.name)) continue;
                if (!isWantedComponent(row.tags)) continue;
                if (!isRequestedDish(row.name)) continue;
                if (!isWantedCourse(row.tags)) continue;
                if (!isWantedCuisine(row.tags)) continue;
                if (!withinTime(row.totalTimeMinutes)) continue;

                suggestions.push({
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    image: row.image,
                    difficulty: row.difficulty,
                    totalTimeMinutes: row.totalTimeMinutes,
                    source:
                        row.source === "recipe"
                            ? "existing_recipe"
                            : "suggestion",
                    ingredients: row.ingredients,
                    tags: row.tags,
                });

                onMetric?.("catalogue.component_hit");

                if (row.source === "recipe") {
                    metadata.vectorSearchHits++;
                } else {
                    metadata.canonicalSearchHits++;
                }
            }
        }

        // Stage 1e results: what people actually serve alongside the anchor.
        //
        // Pushed AHEAD of stage 2 and after 1d because it is the most specific
        // answer this search can give — a real pairing somebody kept, rather
        // than a dish that merely scores well against the words. Gated like the
        // others; `isTheRequestedComponent` is irrelevant here (a pairing is not
        // a component) but costs nothing and stays for uniformity.
        //
        // No `dietResolved` guard: `menu_pairings_for_recipe` takes dietary tag
        // NAMES and filters in SQL over both halves of the catalogue, so an
        // unresolvable restriction cannot reach it as "no filter" the way an
        // empty tag-id array does for `find_recipes`.
        if (suggestions.length < maxResults) {
            for (const row of pairingRows) {
                if (suggestions.some((item) => item.id === row.id)) continue;
                if (isExcluded(row.name)) continue;
                if (!isWantedComponent(row.tags)) continue;
                if (!isWantedCourse(row.tags)) continue;
                if (!isWantedCuisine(row.tags)) continue;
                if (isBlacklisted(row.ingredients)) continue;
                if (!withinTime(row.totalTimeMinutes)) continue;

                suggestions.push({
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    image: row.image,
                    difficulty: row.difficulty,
                    totalTimeMinutes: row.totalTimeMinutes,
                    source:
                        row.source === "recipe"
                            ? "existing_recipe"
                            : "suggestion",
                    ingredients: row.ingredients,
                    tags: row.tags,
                });

                onMetric?.("catalogue.pairing_hit");

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
                !isWantedCourse(existingSuggestion.tags) ||
                !isWantedCuisine(existingSuggestion.tags) ||
                isBlacklisted(existingSuggestion.ingredients) ||
                !withinTime(existingSuggestion.totalTimeMinutes) ||
                isTheRequestedComponent(
                    existingSuggestion.name,
                    existingSuggestion.nameEn
                ) ||
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
            suggestions.length < maxResults &&
            // A suggestion is a dish nobody has paid to generate a recipe for
            // yet, so it is checked against `recipe_suggestion_dietary` rather
            // than `recipe_dietary` — the same rule over the other half of the
            // catalogue, which is exactly how `find_recipes` treats the pair.
            suitsDiet(suggestionQualifies, existingSuggestion.id)
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
                    type: tag.type,
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
                        // What the reader has already seen or asked NOT to see.
                        // Without this the generator answers "something else"
                        // with the same dish, dedup resolves it onto the row
                        // the caller just excluded, and the `existing_recipe`
                        // branch below refuses it — so a refusal produced NO
                        // card rather than a different one.
                        exclude: excludedNames,
                        // The slot the reader asked to fill, when they said.
                        course,
                        // The DTO has taken this since it was written; nothing
                        // ever sent it from chat. One string, because the
                        // generator prompt renders a single `Cuisine:` line.
                        cuisine: cuisine?.[0],
                    },
                    {
                        dish,
                        // What the generated dish is being written to sit
                        // beside. The anchor is already in `exclude` above,
                        // which stops it being RETURNED; this is what stops a
                        // dish being written that CONTAINS it.
                        accompanies: pairsWith,
                        maxMinutes,
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

                    /**
                     * A generated dish is NOT gated on the ceiling, deliberately
                     * — this counts instead.
                     *
                     * The catalogue stages refuse a row over the limit outright,
                     * because there is always another row. Generation is the
                     * LAST stage: refusing here produces an empty turn, and the
                     * honest comparison is between a 25-minute dish for a
                     * 20-minute request and nothing at all.
                     *
                     * Measured 2026-09-14 on the streaming path (the one chat
                     * uses, and the only one that receives `maxMinutes`): a
                     * 20-minute ceiling produced a 20-minute dish. The prompt
                     * line appears to hold, so this is here to say if that stops
                     * being true rather than to act on it. If the counter turns
                     * out to fire often, the fix is a retry — the shape
                     * `MAX_GENERATION_ATTEMPTS` already has for notability —
                     * not a refusal.
                     */
                    if (
                        maxMinutes !== undefined &&
                        !withinTime(enriched.totalTimeMinutes)
                    ) {
                        console.warn(
                            `[SearchRecipeSuggestions] Generated "${enriched.name}" at ${enriched.totalTimeMinutes ?? "unknown"} min against a ${maxMinutes} min ceiling`
                        );
                        onMetric?.("search.generated_over_time_ceiling");
                    }
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
                            type: tag.type,
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
                        onMetric?.("search.dedup_mismatch");

                        /**
                         * **No `unsatisfied` reason, and that is the whole point
                         * of this branch.**
                         *
                         * It used to report `no_known_dish`, which is a STATEMENT
                         * about the request — "there is no established dish
                         * here" — and it is not true of what happened. What
                         * happened is that we wrote a real dish and dedup
                         * resolved it onto a row the caller had already refused.
                         * The request is perfectly answerable; this attempt
                         * simply landed back where it started.
                         *
                         * Saying so mattered because `unsatisfied` is what the
                         * caller's retry round tests: `process-chat` arms a
                         * second round only when the search found nothing AND
                         * gave no reason, so claiming a reason here SUPPRESSED
                         * the one mechanism that could have recovered the turn.
                         * A refusal that circled back to the refused dish ended
                         * as an empty reply with a sentence that was not true.
                         *
                         * Leaving it unset lets that existing round fire, and it
                         * is re-routed with the failed attempt in context — which
                         * is exactly the recovery a refusal needs, using
                         * machinery that is already bounded at two rounds. See
                         * the note on the refusal round in `process-chat`.
                         */
                        return {
                            suggestions: [],
                            searchMetadata: metadata,
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
                    course,
                    cuisine: cuisine?.[0],
                    dietaryRestrictions,
                    blacklist,
                    difficulty,
                    exclude: excludedNames,
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
                            type: tag.type,
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
