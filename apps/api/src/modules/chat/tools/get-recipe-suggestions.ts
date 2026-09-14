import { z } from "zod/v4";

import {
    COMPONENT_TAGS,
    searchRecipeSuggestions,
    type SearchRecipeSuggestionsOptions,
} from "../../recipes/services/search-recipe-suggestions";

/**
 * Optional per-call context threaded through the chat tool-execution path.
 *
 * Nothing here is a value the MODEL could have written — that is the line
 * between this and the three argument layers in `handleToolCalls`. Most of it is
 * a live callback or promise the SERVICE consumes; `shownDishes` is the one
 * plain value, and it qualifies for the same reason: it is a fact the CLIENT
 * holds about its own screen, not a reading of the request. Anything put in the
 * argument layers instead ends up in the search input, where nothing reads it
 * and nothing complains.
 */
export interface RecipeSuggestionToolContext {
    onPartialSuggestion?: SearchRecipeSuggestionsOptions["onPartialSuggestion"];
    onDishReady?: SearchRecipeSuggestionsOptions["onDishReady"];
    onStage?: SearchRecipeSuggestionsOptions["onStage"];
    onMetric?: SearchRecipeSuggestionsOptions["onMetric"];
    speculativeEmbedding?: SearchRecipeSuggestionsOptions["speculativeEmbedding"];
    /**
     * Every dish the conversation has already put on screen — see
     * `ChatRequestSchema.shownDishes`.
     *
     * Merged with the model's own `exclude` rather than replacing it, because
     * the two lists know different things: this one is the complete record of
     * what was shown, and the routed one carries what only a reading of the
     * SENTENCE can supply — the accompanied dish in "what sauce goes with apple
     * strudel", which was never on screen at all.
     *
     * It is context rather than an argument override for a concrete reason:
     * an override REPLACES, and `readRoutedSearch` reads only the first tool
     * call, so a turn that issued two searches would have had the second one's
     * exclusions overwritten by a list computed from the first.
     */
    shownDishes?: string[];
}

/**
 * Input schema for GET_RECIPE_SUGGESTIONS tool
 */
export const RecipeSuggestionInputSchema = z.object({
    query: z
        .string()
        .describe(
            "The search query - a recipe name, dish name, ingredient, sauce type, or any food-related concept, as the user would phrase it. Examples: 'steak sauce', 'pad thai', 'weeknight pasta', 'vegan desserts'. A cuisine may appear here as part of the phrasing, but it must ALSO be set in `cuisine` — this field is matched by similarity and filters nothing, so an origin that lives only here is silently dropped."
        ),
    dish: z
        .string()
        .optional()
        .describe(
            "The plain name of the dish the user wants ON THE PLATE, set whenever they named one: 'a thai green curry recipe please' -> 'Thai Green Curry'; 'how do I make pad thai?' -> 'Pad Thai'; 'how do I make a perfect Bechamel' -> 'Bechamel'. A named BUILDING BLOCK counts when the building block IS what they want to cook — 'how do I make a Bechamel', 'the best pizza dough' — and there you set `component` alongside it. **Do NOT set it for an ingredient the dish merely CONTAINS.** 'a recipe WITH bechamel', 'a dish that USES bechamel', 'something CONTAINING gochujang' are asking for a dish BUILT ON that thing, which is the opposite request — put the thing in `ingredients` and leave this unset. OMIT it too when they described what they want instead of naming it — a category, mood or ingredient question ('an apple dessert', 'what can I make with chicken'). An ORIGIN is never a dish name: 'something Italian' sets `cuisine: ['italian']` and leaves this unset. Setting it restricts existing-recipe matches to exactly that name, so a similar-but-different row (a red curry for a green curry request) cannot be returned in its place; on a vague or contains-this request it would wrongly block every good answer."
        ),
    matchThreshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
            "Minimum similarity score for vector search (0-1). Omit to use the calibrated default — set it only to deliberately widen or narrow a search."
        ),
    maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
            "How many cards to show. Set it ONLY when the user explicitly asks for more than one — 'a few breakfast ideas', 'give me some options', 'three pasta dishes', 'what are my choices' — Use the number they said if they said one; otherwise use 3 for ANY plural ask — 'a few', 'some', 'options', 'choices', 'ideas'. Leave it UNSET for an ordinary request: one dish is the normal answer and a screen of cards for somebody who asked for a recipe is noise. The app caps whatever you ask for, and only dishes ALREADY IN THE CATALOGUE can fill the extra slots — a request that has to be written from scratch gets one however many were asked for, which is deliberate."
        ),
    ingredients: z
        .array(z.string())
        .optional()
        .describe(
            "The concrete things the dish must be BUILT FROM, one per entry, singular and unqualified. Two shapes set this. WHAT THEY HAVE: 'what can I make with chicken and rice?' -> ['chicken', 'rice']. WHAT THE DISH MUST CONTAIN: 'a recipe with bechamel' -> ['bechamel'], 'a dish that uses gochujang' -> ['gochujang'], 'something containing miso' -> ['miso'] — a named sauce, paste, dough or stock goes here, not in `dish`, whenever the user wants a dish that USES it rather than the thing itself. This is the only way an existing recipe is matched by ingredient rather than by name. Omit it when they name the dish they want to eat or a concept. A cuisine is NOT an ingredient and belongs in `cuisine` — 'an Asian dish containing eggs' sets BOTH, `cuisine: ['asian']` and `ingredients: ['egg']`."
        ),
    component: z
        .enum(COMPONENT_TAGS)
        .optional()
        .describe(
            "Set this whenever the user wants to COOK a component rather than a finished dish, in either shape. NAMED OUTRIGHT: 'how do I make a perfect Bechamel' is component 'sauce', 'the best pizza dough' is 'dough', 'how do you make a roux' is 'roux' — set `dish` to the name as well. AS AN ACCOMPANIMENT: 'what sauce goes with apple strudel' is component 'sauce', 'a marinade for chicken' is 'marinade' — put the accompanied dish in `pairsWith`, never in `exclude`. **Never set it when the user wants a dish that USES the component** — 'a recipe with bechamel' wants a lasagne or a gratin, and this field would restrict the answer to sauces, which is exactly backwards. Results are restricted to recipes carrying that component tag and anything generated is forced to be one, which is the ONLY thing that stops a dish built on the component being returned instead of it: similarity alone always scores a bechamel query highest against Lasagne. Omit it for ordinary dish requests."
        ),
    exclude: z
        .array(z.string())
        .optional()
        .describe(
            "Dish names that must NOT be returned. ALWAYS include the dish the user is ruling out, in either shape it arrives: named outright ('something that isn't lasagne' -> ['Lasagne']) or rejected as the card on screen ('something else' after a Cacio e Pepe card -> ['Cacio e Pepe']). Also the dish they want an accompaniment FOR ('what sauce goes with apple strudel' -> ['apple strudel']) — without it the search matches the accompanied dish and hands back the same card. You do NOT need to enumerate every dish shown earlier in the conversation; the app sends that list separately."
        ),
    cuisine: z
        .array(z.string())
        .optional()
        .describe(
            "The cuisine or region the dish must belong to, as plain lowercase names: 'give me an Asian dish' -> ['asian']; 'something Thai' -> ['thai']; 'a Sichuan noodle dish' -> ['sichuan']. Set it WHENEVER the user names an origin, on its own or alongside anything else — 'an Asian dish containing eggs' is `cuisine: ['asian']` AND `ingredients: ['egg']`, and dropping either half answers a different question. A REGION is fine and does not need expanding yourself: the search widens 'asian' to Thai, Korean, Japanese and the rest on its own, while a specific cuisine stays specific. Use the term the user used, at the level they used it. Omit it when no origin is named."
        ),
    maxMinutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
            "The most time the cook has, TOTAL, in whole minutes — set it whenever they say how long they have. Convert the phrase: 'in 20 minutes' -> 20; 'half an hour' -> 30; 'I've got an hour' -> 60; 'something quick' -> 30; 'a quick weeknight dinner' -> 30. It is a CEILING, so give the number they actually said — rounding 20 up to 30 offers them a dish they do not have time to cook. Omit it when no limit is mentioned, and omit it rather than guessing from a vague phrase with no duration in it ('when I get home', 'not a whole afternoon'). **This is about the CLOCK, not the cook.** 'Nothing fancy' and 'not too fiddly' are about SKILL and belong in `difficulty`; a three-hour braise is twenty minutes of work and is not difficult."
        ),
    pairsWith: z
        .string()
        .optional()
        .describe(
            "The dish this request is ABOUT but must NOT return — set whenever the user asks for something to go BESIDE a dish rather than something to cook from it. 'what goes well with Korean chicken' -> 'Korean Fried Chicken'; 'what should I serve with roast chicken' -> 'Roast Chicken'; 'what sauce goes with apple strudel' -> 'Apple Strudel'. Use the plain dish name. The distinction from `ingredients` is whether the named thing goes INTO the pan (ingredients) or sits NEXT TO the finished plate (this): a béchamel goes into a lasagne, kimchi sits beside the chicken. The app removes this dish from the results itself, so do not also list it in `exclude`."
        ),
    course: z
        .enum(["appetizer", "side", "dessert"])
        .optional()
        .describe(
            "Which slot on the table the answer should fill, for a `pairsWith` request. Set it only when the user says which: 'what SIDE goes with lasagne' -> 'side', 'a DESSERT after the curry' -> 'dessert'. Leave it unset for an open 'what goes well with this?', where anything served alongside is a fair answer. There is no 'main' — the dish in `pairsWith` is the main. For a named BUILDING BLOCK accompaniment ('what sauce goes with apple strudel') use `component` instead: a sauce is not a course."
        ),
    refusing: z
        .boolean()
        .optional()
        .describe(
            "True when the user is TURNING DOWN what they were just shown: 'something else', 'no, not that', 'anything but the lasagne', 'give me a different one'. It is what tells the search that a dish appearing in both `dish` and the exclusions should be DROPPED rather than pinned — without it, 'something else' after a Bechamel card searches for Bechamel again and returns the card that was just refused. Leave it unset when the user is asking ABOUT the dish on screen ('what if we add cheese to it?', 'can you make it vegan?'): those are follow-ups, not refusals, and the dish must stay pinned."
        ),
    difficulty: z
        .enum(["easy", "medium", "hard"])
        .optional()
        .describe(
            "How much SKILL the dish should ask of the cook. The scale starts at the real dish and climbs: 'easy' is the standard version cooked properly, 'medium' is a chef-level interpretation, 'hard' is what a Michelin-starred kitchen would send out. Set it ONLY when the user signals SKILL: 'nothing fancy', 'the usual way', 'straightforward' -> 'easy'; 'a bit special', 'impress someone', 'restaurant-level' -> 'medium'; 'go all out', 'a project', 'showstopper', 'Michelin' -> 'hard'. 'Something quick', 'weeknight' and 'no time' are about TIME, not skill — they must NOT set this field. OMIT it whenever they say nothing about skill: the user's own saved level is then applied, and setting this on a hunch overrides their preference."
        ),
    dietaryRestrictions: z
        .array(z.string())
        .optional()
        .describe(
            "Dietary tags every generated suggestion must satisfy (e.g. 'vegan', 'gluten_free')"
        ),
    blacklist: z
        .array(z.string())
        .optional()
        .describe(
            "Ingredients to never suggest (allergies/dislikes); recipes normally containing them are excluded"
        ),
});

/**
 * Output schema for GET_RECIPE_SUGGESTIONS tool
 */
export const RecipeSuggestionOutputSchema = z.object({
    suggestions: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            difficulty: z.enum(["easy", "medium", "hard"]),
            /**
             * Total minutes. Declared so the assistant can answer "how long
             * does this take" from the row rather than guessing a number that
             * would then disagree with the pill on the card beside its own
             * reply.
             */
            totalTimeMinutes: z.number().int().positive().nullable().optional(),
            source: z.enum(["existing_recipe", "suggestion", "new_suggestion"]),
            matchScore: z.number().optional(),
            ingredients: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                })
            ),
            tags: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                })
            ),
        })
    ),
    searchMetadata: z.object({
        vectorSearchHits: z.number(),
        canonicalSearchHits: z.number(),
        newSuggestionsCreated: z.number(),
    }),
    /**
     * Present only when the search came back empty AND knows why — see
     * `SearchUnsatisfied`. Declared here because the tool output is also what
     * the summary turn reads, so a turn that has nothing to offer can at least
     * be summarised honestly rather than skipped.
     */
    unsatisfied: z
        .object({
            reason: z.enum(["no_known_dish", "not_food"]),
            attempted: z.array(z.string()),
        })
        .optional(),
});

export type RecipeSuggestionInput = z.infer<typeof RecipeSuggestionInputSchema>;

/**
 * What each search field DOES, declared so a field cannot be added without
 * someone deciding.
 *
 * ## The failure this exists to catch
 *
 * A field that NARROWS — that says which catalogue rows may be returned — is
 * only worth what its gate is worth. The catalogue stages read tables directly
 * and push whatever they find; a narrowing field with no check at those push
 * sites is a filter the model fills in and nothing applies. It does not fail, it
 * quietly returns a dish that does not satisfy the request, which is this
 * pipeline's whole failure mode.
 *
 * Three rounds of bug reports have now been one instance of it each, and the
 * assertion below was written after the third:
 *
 * - `exclude` was declared on the generator's DTO and rendered by the feed's
 *   prompt but not by chat's, so "something else" returned the same dish.
 * - `pairsWith` did not exist, so the dish a question was ABOUT was returned as
 *   its answer — twice, by two different routes.
 * - `cuisine` did not exist, so "an Asian dish containing eggs" returned Banana
 *   Bread and the reply said so out loud.
 *
 * Writing this map immediately turned up two more that no screenshot had
 * reached yet:
 *
 * - **`blacklist`** reached stages 1c, 1d, 1e and both generators — every path
 *   that filters in SQL or writes a prompt — and NO push site. The three stages
 *   that read tables directly could return a dish containing an ingredient the
 *   reader is allergic to.
 * - **`course`** reached the pairing retrieval and the generator only, so "what
 *   side goes with lasagne" could be answered with a main.
 *
 * ## What it does and does not prove
 *
 * Exactly what `assertMeteredMountsAreGated` proves about a metered route: that
 * a gate is PRESENT and named, not that it is correct. That is worth having on
 * its own — every failure above was an absence, not a bug in a check — and it
 * costs nothing at runtime.
 *
 * The map is keyed off the zod schema at boot, so a new field is caught by its
 * ABSENCE here rather than by anyone remembering to update a list.
 */
type FieldRole =
    /** Restricts which catalogue rows may be returned. Must name a gate. */
    | { role: "narrowing"; gate: string }
    /** Steers what is GENERATED; deliberately does not filter retrieval. */
    | { role: "generation-only"; why: string }
    /** Changes how another field is read rather than narrowing anything. */
    | { role: "modifier"; of: string }
    /** Neither a constraint nor a filter — the query text, limits, tuning. */
    | { role: "plumbing" };

export const SEARCH_FIELD_ROLES: Record<string, FieldRole> = {
    query: { role: "plumbing" },
    matchThreshold: { role: "plumbing" },
    maxResults: { role: "plumbing" },

    dish: { role: "narrowing", gate: "isRequestedDish" },
    ingredients: { role: "narrowing", gate: "containsRequestedIngredient" },
    component: { role: "narrowing", gate: "isWantedComponent" },
    course: { role: "narrowing", gate: "isWantedCourse" },
    maxMinutes: { role: "narrowing", gate: "withinTime" },
    cuisine: { role: "narrowing", gate: "isWantedCuisine" },
    exclude: { role: "narrowing", gate: "isExcluded" },
    pairsWith: { role: "narrowing", gate: "isExcluded (folded into excludedNames)" },
    dietaryRestrictions: { role: "narrowing", gate: "suitsDiet" },
    blacklist: { role: "narrowing", gate: "isBlacklisted" },

    refusing: { role: "modifier", of: "dish" },
    difficulty: {
        role: "generation-only",
        why: "filtering the catalogue by difficulty would empty the result on a catalogue that skews medium, and a stage that already found a dish answering the question should return it. The hint is about what we WRITE, not about refusing what we already have.",
    },
};

/**
 * Refuse to boot when a search field has no declared role.
 *
 * Loud and at boot, like `assertMeteredMountsAreGated` — a warning on a Lambda
 * cold start is a line nobody reads, while a failed boot is identical in dev and
 * production and cannot be skipped the way a test can.
 */
export function assertSearchFieldsAreGated(): void {
    const declared = Object.keys(RecipeSuggestionInputSchema.shape);
    const undeclared = declared.filter((field) => !SEARCH_FIELD_ROLES[field]);

    if (undeclared.length > 0) {
        throw new Error(
            `[Chat] GET_RECIPE_SUGGESTIONS declares ${undeclared.join(", ")} with no entry in SEARCH_FIELD_ROLES.\n` +
                "Every search field has to say what it does. If it NARROWS which catalogue rows may be returned, it needs a gate at the push sites in `searchRecipeSuggestions` and must name it here — a filter nothing applies does not fail, it returns a dish that does not satisfy the request."
        );
    }

    // A stale entry is the other half: a field removed from the schema but left
    // here reads as coverage for something that no longer exists.
    const orphaned = Object.keys(SEARCH_FIELD_ROLES).filter(
        (field) => !declared.includes(field)
    );

    if (orphaned.length > 0) {
        throw new Error(
            `[Chat] SEARCH_FIELD_ROLES describes ${orphaned.join(", ")}, which GET_RECIPE_SUGGESTIONS no longer declares.`
        );
    }
}

/**
 * Diets that are named outright rather than as an absence.
 *
 * A closed, stable set — the other seven dietary tags are all `<something>
 * free`, which the suffix rule below catches without a list. None of these is a
 * plausible ingredient, which is what makes moving them safe.
 */
const NAMED_DIETS = new Set([
    "vegan",
    "vegetarian",
    "pescatarian",
    "flexitarian",
    "keto",
    "paleo",
    "halal",
    "kosher",
    "low carb",
    "low fat",
    "low sodium",
    "high protein",
]);

/** `dairy free`, `gluten-free`, `egg_free` — a diet, never a thing in a pan. */
const isFreeForm = (name: string): boolean => /(^|[\s_-])free$/.test(name.trim());

/**
 * Repair an `ingredients` entry that is really a DIETARY constraint that lost
 * its sign.
 *
 * ## The failure
 *
 * Measured 2026-09-14. "a cake with no eggs" routed to `ingredients: ["egg"]`
 * in 2 runs of 3 — the reader asked for a cake WITHOUT eggs and the search was
 * told the dish must CONTAIN them. `egg` resolves to a real ingredient row, so
 * that is a live inversion rather than a no-op: it actively prefers the one
 * thing that was ruled out.
 *
 * ## Why the guard is narrow, and why it cannot be wider
 *
 * The obvious rule — drop an `ingredients` entry that names a dietary term — is
 * wrong, and the measurement says so plainly. In the same sweep:
 *
 *   "a cake with NO eggs"          -> ingredients: ["egg"]   (inverted)
 *   "an Asian dish CONTAINING eggs" -> ingredients: ["egg"]   (correct)
 *
 * **Identical arguments, opposite meanings.** Nothing this function can see
 * separates them, because the only thing that differs is a word in the sentence.
 * A rule that dropped `egg` would break the very turn the cuisine slot was built
 * for. The same holds for every entry in `DIETARY_PROPERTIES` — `nuts`,
 * `dairy`, `soy` are all legitimate things to ask for a dish to contain.
 *
 * So the real fix is at ROUTING, where the sentence is visible, and this catches
 * only the cases that are unambiguous no matter what was said:
 *
 * 1. **A `-free` form** — "dairy free" is never an ingredient.
 * 2. **A named diet** — nobody asks for a dish containing vegan.
 * 3. **A contradiction** — the same term in `ingredients` AND in `blacklist` or
 *    `exclude`. The caller said both; the negative wins, because requiring
 *    something the reader ruled out is the unsafe direction.
 *
 * Cases 1 and 2 are MOVED to `dietaryRestrictions` rather than discarded, so the
 * constraint survives instead of evaporating. Case 3 is dropped — the negative
 * is already carried by the field it belongs in.
 */
function repairInvertedDietary(
    input: RecipeSuggestionInput
): RecipeSuggestionInput {
    const ingredients = input.ingredients ?? [];

    if (ingredients.length === 0) return input;

    const negatives = new Set(
        [...(input.blacklist ?? []), ...(input.exclude ?? [])].map((name) =>
            name.trim().toLowerCase()
        )
    );

    const kept: string[] = [];
    const movedToDiet: string[] = [];
    const dropped: string[] = [];

    for (const raw of ingredients) {
        const name = raw.trim().toLowerCase();

        if (isFreeForm(name) || NAMED_DIETS.has(name)) {
            movedToDiet.push(raw);
            continue;
        }

        if (negatives.has(name)) {
            dropped.push(raw);
            continue;
        }

        kept.push(raw);
    }

    if (movedToDiet.length === 0 && dropped.length === 0) return input;

    console.warn(
        `[RecipeSuggestions] Repaired inverted constraints on \`ingredients\`:` +
            (movedToDiet.length
                ? ` moved ${JSON.stringify(movedToDiet)} to dietaryRestrictions;`
                : "") +
            (dropped.length
                ? ` dropped ${JSON.stringify(dropped)} (also excluded);`
                : "")
    );

    return {
        ...input,
        ingredients: kept,
        dietaryRestrictions: [
            ...(input.dietaryRestrictions ?? []),
            ...movedToDiet,
        ],
    };
}

/**
 * The search input with the client's shown-dishes list folded into `exclude`.
 *
 * Union, not replacement, and deduplicated case-insensitively so a dish the
 * model also named is listed once. Order puts the ROUTED names first: they are
 * the ones this turn is specifically about, and if anything downstream ever
 * truncates the list it should keep those.
 *
 * **The pin is not defended here, deliberately.** A dish named in `dish` will
 * almost always also be in `shownDishes` — it is on screen, that is what the
 * list means — so this union routinely produces the pinned-and-forbidden shape
 * that `searchRecipeSuggestions` already exists to resolve. Re-implementing that
 * resolution here would be a second copy of the rule, free to disagree with the
 * one the catalogue stages and the generator both read. One owner, and it is
 * the search.
 */
function mergeExclusions(
    input: RecipeSuggestionInput,
    context: RecipeSuggestionToolContext
): RecipeSuggestionInput {
    const shown = context.shownDishes ?? [];

    if (shown.length === 0) return input;

    const merged = [
        ...new Map(
            [...(input.exclude ?? []), ...shown]
                .map((name) => name.trim())
                .filter(Boolean)
                .map((name) => [name.toLowerCase(), name])
        ).values(),
    ];

    return { ...input, exclude: merged };
}

/**
 * Tool handler for getting recipe suggestions.
 * Returns the tool-call content array the chat pipeline expects.
 */
export async function getRecipeSuggestionsHandler(
    input: RecipeSuggestionInput,
    context: RecipeSuggestionToolContext = {}
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const result = await searchRecipeSuggestions(
        repairInvertedDietary(mergeExclusions(input, context)),
        {
        onPartialSuggestion: context.onPartialSuggestion,
        onDishReady: context.onDishReady,
        onStage: context.onStage,
        onMetric: context.onMetric,
        speculativeEmbedding: context.speculativeEmbedding,
    });

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}

/**
 * Tool definition for GET_RECIPE_SUGGESTIONS
 */
export const getRecipeSuggestionsTool = {
    name: "GET_RECIPE_SUGGESTIONS",
    definition: {
        title: "Get Recipe Suggestions",
        description:
            "Search for and get recipe suggestions based on any query about food, recipes, ingredients, dishes, or cooking. This tool searches existing recipes first, then generates new authentic recipe suggestions if nothing is found. Use this whenever the user asks about recipes, dishes, sauces, ingredients, cooking methods, or food recommendations. Returns detailed recipes with ingredients, tags, difficulty levels, and descriptions.",
        inputSchema: RecipeSuggestionInputSchema,
        outputSchema: RecipeSuggestionOutputSchema,
    },
    handler: getRecipeSuggestionsHandler,
};
