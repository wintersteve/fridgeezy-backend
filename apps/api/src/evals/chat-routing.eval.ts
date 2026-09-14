// Must be the first import — the Supabase client throws on a missing
// SUPABASE_URL at *import* time, before any statement in this file would run.
import "dotenv/config";

import type { ChatMessage } from "@fridgeezy/schemas";

import {
    convertToolsToOpenAiTools,
    createChatCompletion,
    readRoutedSearch,
    type RoutedSearch,
} from "../modules/chat/services";
import { getRecipeSuggestionsTool, planMenuTool } from "../modules/chat/tools";
import {
    ROUTING_MODEL,
    SYSTEM_PROMPT,
} from "../modules/chat/usecases/process-chat/process-chat";

/**
 * Does the routing call still pin the search correctly on a cheaper model?
 *
 *   npx nx run @fridgeezy/api:eval-chat-routing
 *   CHAT_ROUTING_MODEL=gpt-4o npx nx run @fridgeezy/api:eval-chat-routing
 *
 * The first model call of a chat turn writes nothing the user reads — it fills
 * in search arguments — so it is the obvious candidate for a smaller, faster
 * model. What makes that risky is that almost every argument it fills in exists
 * because of a specific past failure, and those instructions are exactly the
 * kind a weaker model drops first:
 *
 *   * `dish` is what stops a green-curry request being answered with Thai Red
 *     Curry. Similarity alone always scores the sibling high enough.
 *   * `component` is what stops "how do I make a Béchamel" being answered with
 *     Lasagne — the nearest match to a sauce is always a dish built on it.
 *   * `exclude` is what stops a follow-up about an accompaniment handing back
 *     the card the conversation is already looking at.
 *
 * None of those fail loudly. They return a plausible, wrong recipe, which is why
 * this exists as a gate rather than as something to check by hand after a swap.
 *
 * Nothing is generated, persisted or searched: each case is one routing call,
 * and only the arguments it produced are inspected.
 */

interface Case {
    message: string;
    /** Which tool must be chosen. Defaults to the dish search. */
    tool?: "GET_RECIPE_SUGGESTIONS" | "PLAN_MENU";
    /**
     * Assert NO tool was called — the turn is a question the model answers in
     * prose itself.
     *
     * The half of the fork with no card at the end of it, and the one that
     * fails invisibly: a question answered with a recipe card still produces
     * something on screen, so nothing looks broken. It is only wrong if you
     * read it.
     */
    noTool?: boolean;
    /**
     * `noTool` only: a lowercased substring the prose answer must contain.
     *
     * Answering in prose is only half of it. The chat has no tool calls in the
     * history it is sent back, so the ONLY thing that carries a dish into the
     * next turn is the assistant having said its name — answer "yes, that's a
     * cheese sauce" and "give me that recipe" has nothing to resolve. Naming it
     * is what makes the follow-up case below work.
     */
    answerNames?: string;
    /** PLAN_MENU only: lowercased substrings the `courses` array must contain. */
    courses?: string[];
    /**
     * PLAN_MENU only: assert `courses` was left UNSET.
     *
     * The harder half of the rule, and the one worth guarding. A model that
     * fills in a plausible default looks like it is being helpful and silently
     * removes the only moment at which the user is asked which courses they
     * want.
     */
    noCourses?: boolean;
    /** Prior conversation, for the cases that only exist as follow-ups. */
    history?: ChatMessage[];
    /** Lowercased substring the `dish` argument must contain. */
    dish?: string;
    /** `true` asserts `dish` was left UNSET — the harder half of the rule. */
    noDish?: boolean;
    component?: string;
    /** `true` asserts no component filter was applied. */
    noComponent?: boolean;
    /** Lowercased substrings, each of which some `exclude` entry must contain. */
    exclude?: string[];
    /**
     * Lowercased substrings that no `exclude` entry may contain.
     *
     * For the one shape that makes the search unsatisfiable: the same dish in
     * `dish` and in `exclude`. `searchRecipeSuggestions` now throws the
     * exclusion away rather than trusting this, so a miss here is a prompt
     * regression rather than a live outage — which is exactly why it is worth
     * catching in the eval instead of in a support ticket.
     */
    noExclude?: string[];
    /** Lowercased substrings, each of which some `ingredients` entry must contain. */
    ingredients?: string[];
    /**
     * `true` asserts this turn cannot come back pinned to the dish being refused.
     *
     * Satisfied EITHER by `refusing: true` or by leaving `dish` unset, because
     * those are the two shapes with the same outcome — `refusing` exists only to
     * break the tie when a pin and an exclusion name the same dish, so with no
     * pin there is nothing for it to decide. Asserting the flag alone would fail
     * a route that is already correct, which is how this assertion was first
     * written and what it flagged: "something else" after a CONCEPT request
     * ("a pasta dish") excludes the card and pins nothing, and needs no flag.
     */
    refusing?: boolean;
    /**
     * `true` asserts `refusing` was left unset.
     *
     * The harder half, and the one that protects the 2026-09-03 fix: a follow-up
     * ABOUT the dish on screen ("what if we add cheese to it?") must not be read
     * as a refusal, or the pin is dropped and the turn answers a question nobody
     * asked.
     */
    noRefusing?: boolean;
    /** Lowercased substrings, each of which some `dietaryRestrictions` entry must contain. */
    diet?: string[];
    /** Lowercased substrings, each of which some `blacklist` entry must contain. */
    blacklist?: string[];
    /**
     * `true` asserts `ingredients` was left EMPTY.
     *
     * For the negation cases. "a cake with no eggs" routing to
     * `ingredients: ["egg"]` asks for exactly what was ruled out — and `egg`
     * resolves to a real row, so it is a live inversion rather than a no-op.
     */
    noIngredients?: boolean;
    /** The exact `maxResults` the router must ask for. */
    maxResults?: number;
    /** `true` asserts `maxResults` was left UNSET — one card is the normal answer. */
    noMaxResults?: boolean;
    /** The exact `maxMinutes` ceiling expected. */
    maxMinutes?: number;
    /** `true` asserts `maxMinutes` was left UNSET — no duration was stated. */
    noMaxMinutes?: boolean;
    /** The exact `difficulty` expected. */
    difficulty?: string;
    /** `true` asserts `difficulty` was left UNSET. */
    noDifficulty?: boolean;
    /** Lowercased substrings, each of which some `cuisine` entry must contain. */
    cuisine?: string[];
    /** `true` asserts `cuisine` was left UNSET — no origin was named. */
    noCuisine?: boolean;
    /** Lowercased substring the `pairsWith` anchor must contain. */
    pairsWith?: string;
    /** `true` asserts `pairsWith` was left UNSET — this is not a pairing turn. */
    noPairsWith?: boolean;
    /** The exact `course` slot expected, for a pairing turn that named one. */
    course?: string;
    /**
     * Opt out of the "assert more than the tool" guard, deliberately and
     * visibly. Only for a case whose entire subject IS which tool was chosen.
     */
    toolOnly?: boolean;
    why: string;
}

/**
 * Every assertion key. A case must use at least one BEYOND `tool`.
 *
 * ## What this guard is for, and why it is code rather than a comment
 *
 * A case asserting only `tool: "GET_RECIPE_SUGGESTIONS"` checks that a tool was
 * called. It does not check WHICH SEARCH was run — and a wrong search is this
 * pipeline's entire failure mode. It does not surface as an error; it surfaces
 * as a plausible, wrong recipe.
 *
 * Measured 2026-09-13, and this is not hypothetical. `"what should I serve with
 * roast chicken?"` asserted only the tool. It passed in every run for weeks
 * while routing to `ingredients: ["roast chicken"]` — the CONTAINS shape, which
 * asks for a dish CONTAINING the chicken rather than one served beside it. The
 * eval was green on precisely the arguments that produced the bug report. Two
 * more cases (`"how do I make a Béchamel?"`, `"what can I do with leftover roast
 * chicken?"`) asserted NOTHING at all and could never have failed.
 *
 * **A green eval asserting the wrong thing is worse than no eval**: it is a
 * standing claim that a behaviour is covered. So the harness refuses to run
 * rather than letting a weak case sit in the list looking like coverage. If a
 * case genuinely only cares which tool was chosen, say so with `toolOnly: true`
 * — a deliberate, visible exemption rather than an omission.
 */
const ASSERTION_KEYS = [
    "noTool",
    "dish",
    "noDish",
    "component",
    "noComponent",
    "exclude",
    "noExclude",
    "ingredients",
    "refusing",
    "noRefusing",
    "cuisine",
    "noCuisine",
    "diet",
    "blacklist",
    "noIngredients",
    "maxMinutes",
    "noMaxMinutes",
    "maxResults",
    "noMaxResults",
    "difficulty",
    "noDifficulty",
    "pairsWith",
    "noPairsWith",
    "course",
    "courses",
    "noCourses",
    "answerNames",
] as const;

const CASES: Case[] = [
    // --- A named dish must be pinned --------------------------------------
    {
        message: "a thai green curry recipe please",
        dish: "green curry",
        noComponent: true,
        why: "unpinned, this comes back as Thai Red Curry — the sibling scores above threshold",
    },
    {
        message: "how do I make pad thai?",
        dish: "pad thai",
        why: "a question is still a naming",
    },

    // --- A named building block is BOTH a dish and a component ------------
    {
        message: "how do I make a perfect Béchamel",
        dish: "chamel",
        component: "sauce",
        why: "the silent failure: without `component` the nearest match is Lasagne",
    },
    {
        message: "the best pizza dough",
        dish: "pizza dough",
        component: "dough",
        why: "a dough is a component even when it is the whole request",
    },

    // --- ...and "a recipe WITH it" is the OPPOSITE request -----------------
    //
    // The conversation that produced this section (2026-09-12, four turns, no
    // useful answer): "Give me a recipe with Béchamel" routed to
    // `dish: "Béchamel", component: "sauce"` — 3 runs out of 3 — and came back
    // with the béchamel itself. Replayed alongside "how do I make a Béchamel",
    // the two produced byte-identical arguments, which is the whole defect: one
    // preposition apart, opposite requests, one routing.
    //
    // Both halves are pinned here deliberately. Loosening the rule far enough to
    // fix "with" would break "how do I make", and that failure is silent too —
    // the nearest match to a sauce is always a dish built on it.
    {
        message: "Give me a recipe with Béchamel",
        ingredients: ["chamel"],
        noDish: true,
        noComponent: true,
        why: "they want a lasagne or a gratin, not the sauce — pinning the dish answers the opposite question, and `component: sauce` additionally forbids every dish that could have been right",
    },
    {
        message: "Give me a dish that uses gochujang",
        ingredients: ["gochujang"],
        noDish: true,
        noComponent: true,
        why: "'uses' is the same shape as 'with'; a named paste is an ingredient here, not the dish",
    },
    {
        message: "what can I make with leftover pesto?",
        ingredients: ["pesto"],
        noDish: true,
        why: "the pantry phrasing of the same request — the answer is trofie or a sandwich, never the pesto",
    },
    {
        message: "a recipe with chicken",
        ingredients: ["chicken"],
        noDish: true,
        why: "the rule is about the preposition, not about sauces — an ordinary ingredient takes the same path",
    },
    {
        message: "how do you make a roux",
        component: "roux",
        why: "its own component kind, not 'sauce'",
    },

    // --- A component as an ACCOMPANIMENT excludes what it accompanies -----
    {
        message: "what sauce goes with apple strudel",
        component: "sauce",
        pairsWith: "strudel",
        noDish: true,
        why: "a COMPONENT accompaniment: they named the kind (`component`) and the dish it accompanies (`pairsWith`). It asserted `exclude` until 2026-09-13, which was the model doing the search's job — the anchor is now removed from the results by `searchRecipeSuggestions` whether or not the model also lists it, so the anchor field is what this must pin",
    },
    {
        message: "a marinade for chicken",
        component: "marinade",
        why: "the accompaniment shape, on the first message",
    },

    // --- A DESCRIPTION must not be pinned ---------------------------------
    {
        message: "show me an apple dessert",
        noDish: true,
        why: "pinning a description blocks every good answer — there is no dish called 'apple dessert'",
    },
    {
        message: "something Italian tonight",
        noDish: true,
        cuisine: ["italian"],
        why: "a cuisine is not a name — AND the origin has to be carried. Measured 2026-09-14 at 3/8 while the case asserted only `noDish`: a bare adjective plus a vague time reads as a concept query and the origin was dropped. The weak-case guard cannot catch this shape, because the case DOES assert something, just not the thing that was failing",
    },

    // --- Ingredient questions are a FILTER, not a search ------------------
    {
        message: "what can I make with chicken and rice?",
        ingredients: ["chicken", "rice"],
        noDish: true,
        why: "the only stage that can answer this needs ingredient ids; a similarity search scores 0.429 against even the right recipe",
    },

    // --- Menus: several courses, not one dish -----------------------------
    {
        message: "give me a traditional Italian menu, pasta based",
        tool: "PLAN_MENU",
        noCourses: true,
        why: "the request the feature was built for — and it says nothing about courses, so the app must ask rather than assume",
    },
    {
        message: "give me a french menu with a side and dessert",
        tool: "PLAN_MENU",
        courses: ["side", "dessert"],
        why: "the courses are in the prompt, so there is nothing to ask",
    },
    {
        message: "I'm hosting a dinner party for six on Saturday, something Thai",
        tool: "PLAN_MENU",
        noCourses: true,
        why: "a dinner party is a menu even though the word 'menu' never appears — and still says nothing about courses",
    },
    {
        message: "plan me a three course vegetarian meal",
        tool: "PLAN_MENU",
        courses: ["appetizer", "dessert"],
        why: "'three course' DOES say: the main is the seed, so the other two are the ones asked for",
    },

    // --- ...and the things that only LOOK like menus -----------------------
    {
        message: "a one-pot dinner for tonight",
        tool: "GET_RECIPE_SUGGESTIONS",
        noDish: true,
        noPairsWith: true,
        why: "the trap: a dish that IS a whole meal is still one dish — described, not named, and nothing is being accompanied",
    },
    {
        message: "what should I serve with roast chicken?",
        tool: "GET_RECIPE_SUGGESTIONS",
        pairsWith: "chicken",
        noDish: true,
        why: "an accompaniment to a dish already chosen, not a request to plan the meal — and NOT a dish containing chicken. This case asserted only the tool for weeks and passed the whole time on `ingredients: [\"roast chicken\"]`, which is the CONTAINS shape",
    },
    {
        message: "something hearty for dinner",
        tool: "GET_RECIPE_SUGGESTIONS",
        noDish: true,
        noPairsWith: true,
        why: "an occasion is not a course count, and a mood is not a dish to pin or to pair with",
    },

    // --- Follow-ups resolve pronouns and exclude what was shown -----------
    {
        message: "what sauce goes with it?",
        history: [
            { role: "user", content: "give me a chicken parmesan recipe" },
            {
                role: "assistant",
                content:
                    "Here's Chicken Parmesan — breaded chicken baked under tomato sauce and mozzarella.",
            },
        ],
        component: "sauce",
        pairsWith: "parmesan",
        why: "'it' has to be resolved against the conversation before the anchor can be excluded — the pronoun form of the case above",
    },
    {
        message: "something else",
        history: [
            { role: "user", content: "a pasta dish" },
            {
                role: "assistant",
                content: "Here's Cacio e Pepe — pecorino, black pepper and pasta water.",
            },
        ],
        exclude: ["cacio"],
        refusing: true,
        why: "a bare refusal after a concept request — `refusing` is what stops the pin being honoured when the router also names the dish",
    },

    // --- A refusal after a PINNED dish ------------------------------------
    //
    // The half the "something else" case above never covered: there, nothing was
    // pinned (the request was a concept, "a pasta dish"), so `exclude` alone was
    // enough. After a NAMED dish the router keeps pinning it — measured
    // 2026-09-13, "Something else" after a Béchamel card produced three
    // different routes across three runs, one of which pinned and excluded the
    // very same dish, and none of which excluded the dish shown two turns
    // earlier.
    //
    // `refusing` is what resolves it, and it is asserted rather than `noDish`
    // because the pin is still USEFUL here: the search needs the name to know
    // what is being refused, and drops it itself.
    {
        message: "Something else",
        history: [
            { role: "user", content: "Give me a recipe with Béchamel" },
            {
                role: "assistant",
                content:
                    "I found Béchamel — the classic French white sauce, thickened with a roux and scented with nutmeg.",
            },
        ],
        refusing: true,
        why: "the reader is turning the card down; without `refusing` the pin survives and the same card comes back",
    },
    {
        message: "Something that isn't lasagna and contains Béchamel",
        history: [
            { role: "user", content: "Give me a recipe with Béchamel" },
            {
                role: "assistant",
                content: "Lasagne is the answer — layered pasta, ragù and béchamel.",
            },
        ],
        ingredients: ["chamel"],
        exclude: ["lasagn"],
        noDish: true,
        why: "both halves at once: the negative constraint is a plain exclusion, and 'contains Béchamel' is still the ingredient shape — pinning the sauce here is what returned the sauce",
    },

    // --- ...and a FOLLOW-UP is not a refusal -------------------------------
    //
    // The 2026-09-03 fix, re-pinned. These turns are ABOUT the dish on screen,
    // so the pin has to survive — and now that the app sends every shown dish as
    // `shownDishes`, the dish on screen is ALWAYS in the exclusion set, which
    // means `refusing` is the only thing standing between these and an unpinned
    // search. A false positive here breaks the case the collision guard exists
    // for.
    {
        message: "can you make it spicier?",
        history: [
            { role: "user", content: "a chicken tikka masala recipe" },
            {
                role: "assistant",
                content:
                    "Here's Chicken Tikka Masala — grilled chicken in a spiced tomato and cream sauce.",
            },
        ],
        noRefusing: true,
        why: "asking for MORE from this dish is not asking for a different one",
    },
    {
        message: "I'd like that but without the cream",
        history: [
            { role: "user", content: "a chicken tikka masala recipe" },
            {
                role: "assistant",
                content:
                    "Here's Chicken Tikka Masala — grilled chicken in a spiced tomato and cream sauce.",
            },
        ],
        noRefusing: true,
        why: "'that but without X' is an adaptation of the dish on screen, not a request for a different one — the nearest thing to a refusal that is not one",
    },

    // --- A VARIATION is a request for the variation ------------------------
    //
    // Measured 2026-09-03 and the reason this section exists. After a Béchamel
    // card, "What if we add cheese to it?" routed to
    // `dish: "Béchamel", exclude: ["Béchamel"]` — pinned and forbidden at once,
    // which no row can satisfy. Asked outright a second time, in full words, it
    // still dropped the cheese and pinned plain Béchamel. Three turns, nothing
    // written, and the model knew the word the whole time: asked
    // "what is bechamel with cheese called?" it answers Mornay.
    {
        message: "What if we add cheese to it?",
        history: [
            { role: "user", content: "Can you give me a Béchamel recipe" },
            {
                role: "assistant",
                content:
                    "I found Béchamel Sauce — butter, flour and milk, the base for lasagne and gratins.",
            },
        ],
        noTool: true,
        answerNames: "mornay",
        why: "asking what WOULD happen is a question, and the same sentence is answered in prose on the recipe chat — but it has to say the word, or the follow-up below has nothing to go on",
    },
    {
        message: "great, give me that recipe",
        history: [
            { role: "user", content: "Can you give me a Béchamel recipe" },
            {
                role: "assistant",
                content:
                    "I found Béchamel Sauce — butter, flour and milk, the base for lasagne and gratins.",
            },
            { role: "user", content: "What if we add cheese to it?" },
            {
                role: "assistant",
                content:
                    "Add grated cheese to a béchamel and it becomes a Mornay sauce — Gruyère and Parmesan are the classic pair.",
            },
        ],
        dish: "mornay",
        noExclude: ["chamel"],
        why: "the other half of the pair: the answer named the dish, so this turn can pin it — and the béchamel it is built ON must not be excluded",
    },
    {
        message: "Can you give me a recipe for Béchamel with cheese",
        dish: "mornay",
        why: "spelled out in full, with no history to lean on — the modifier is the whole request",
    },
    {
        message: "can you make it vegan?",
        history: [
            { role: "user", content: "a carbonara recipe" },
            {
                role: "assistant",
                content: "Here's Carbonara — guanciale, egg, pecorino and pepper.",
            },
        ],
        noExclude: ["carbonara"],
        noRefusing: true,
        why: "a variation with no established name of its own: whatever `dish` ends up as, excluding the base cannot be right — and asking for a version of the dish is not refusing it",
    },

    // --- A QUESTION is answered, not searched ------------------------------
    //
    // The general chat has only two tools and both end in a card, so every
    // question used to be answered by searching for a dish. "is bechamel the
    // same as white sauce?" returned a Béchamel card and a summary describing
    // it — a yes/no question answered with a recipe.
    {
        message: "is bechamel the same as white sauce?",
        noTool: true,
        why: "a comparison is a question; a card answers it with the wrong kind of thing",
    },
    {
        message: "how long does bechamel keep in the fridge?",
        noTool: true,
        why: "nothing to cook here — this one already worked and must keep working",
    },
    {
        message: "what is bechamel with cheese called?",
        noTool: true,
        why: "asking for a NAME is not asking for a recipe; naming it in prose is what lets the next turn find it",
    },
    {
        message: "why does my hollandaise split?",
        noTool: true,
        why: "a technique question — the answer is an explanation, not a hollandaise card",
    },

    // --- ...and the questions that ARE requests for a card -----------------
    {
        message: "how do I make a Béchamel?",
        dish: "chamel",
        component: "sauce",
        noPairsWith: true,
        noMaxResults: true,
        why: "phrased as a question, but it wants the recipe — the fork must not swallow this. It asserted NOTHING until 2026-09-13 and so could never have failed",
    },
    {
        message: "what can I do with leftover roast chicken?",
        ingredients: ["chicken"],
        noDish: true,
        noPairsWith: true,
        why: "a question in form, a request for something to cook in substance — leftovers go INTO the next dish, so this is CONTAINS and not GOES WITH",
    },

    // --- NEGATION: a ruled-out thing is never an `ingredients` entry -------
    //
    // Measured 2026-09-14 by the field sweep, and the sharpest finding in it:
    //
    //   "a cake with NO eggs"           -> ingredients: ["egg"]   2 runs of 3
    //   "an Asian dish CONTAINING eggs" -> ingredients: ["egg"]   3 runs of 3
    //
    // Identical arguments, opposite requests. `egg` resolves to a real
    // ingredient row, so the first is a LIVE inversion — the search is told the
    // dish must contain the one thing that was ruled out. Nothing downstream can
    // separate them, because the only difference is a word in the sentence, so
    // both halves are pinned here and the fix has to be at routing.
    {
        message: "a cake with no eggs",
        diet: ["egg"],
        noIngredients: true,
        why: "the inversion. `ingredients` means the dish must CONTAIN this, so a negated term there asks for exactly what was refused",
    },
    {
        message: "something for dinner, no dairy",
        diet: ["dairy"],
        noIngredients: true,
        why: "the same shape without a dish attached",
    },
    {
        message: "I'm vegetarian, what should I cook tonight?",
        diet: ["vegetarian"],
        why: "a diet named outright — and until the floor layer landed on 2026-09-14 this was routed correctly and then overwritten with the profile's empty list",
    },
    {
        message: "something for dinner, nothing with nuts",
        diet: ["nut"],
        noIngredients: true,
        why: "an allergy with a diet behind it (`nut free` is a tag), so it belongs in `dietaryRestrictions`. It routed 12/12 and reached the search 0/12 before the floor fix",
    },
    {
        message: "a pasta dish but I hate coriander",
        blacklist: ["coriander"],
        why: "a dislike with no diet behind it belongs in `blacklist`, not `dietaryRestrictions`",
    },
    {
        message: "an Asian dish containing eggs",
        ingredients: ["egg"],
        cuisine: ["asian"],
        why: "the POSITIVE half of the pair above, which any guard on `ingredients` would break — this one must keep working",
    },

    // --- SEVERAL: an explicit ask for more than one ------------------------
    //
    // Reported 2026-09-14: "Can you give me a few recipes ideas for breakfast?"
    // returned one card. `maxResults` existed but was overridden to 1 in
    // `process-chat`, so the router's value never survived.
    //
    // Both halves are pinned. The unstated case is the one that costs something
    // if it drifts — a screen of cards for somebody who asked for a recipe is
    // noise, and the extra slots are only free when the CATALOGUE fills them.
    {
        message: "Can you give me a few recipes ideas for breakfast?",
        maxResults: 3,
        why: "the reported turn. 'A few' is an explicit ask for several — the app caps it, but the router has to carry it or the cap has nothing to clamp",
    },
    {
        message: "give me three pasta dishes",
        maxResults: 3,
        why: "a number said outright is the number to pass",
    },
    {
        message: "what are my options for a quick lunch?",
        maxResults: 3,
        why: "'options' is plural even without a number. Deliberately does NOT assert `maxMinutes`: 'a quick lunch' carries the ceiling in only about half of runs, where the bare 'something quick' carries it every time — pinning the weaker signal would make this case flaky about something it is not testing",
    },
    {
        message: "give me a carbonara recipe",
        noMaxResults: true,
        why: "the harder half: an ordinary request wants ONE dish, and inventing a multi-card answer is noise",
    },
    // --- TIME: the clock is not the cook -----------------------------------
    //
    // `maxMinutes` did not exist until 2026-09-14, and the constraint landed in
    // the nearest field instead: "something quick for a weeknight" set
    // `difficulty: "easy"` in 3 runs of 3, which that field's own description
    // explicitly forbids. Same leak as "something Thai" reaching `courses`.
    {
        message: "something I can make in 20 minutes",
        maxMinutes: 20,
        noDifficulty: true,
        why: "a ceiling, at the number they said — rounding 20 up to the `quick` band's 30 offers a dish there is no time to cook",
    },
    {
        message: "I've only got half an hour, what can I cook?",
        maxMinutes: 30,
        why: "a duration in words rather than digits",
    },
    {
        message: "something quick for a weeknight",
        maxMinutes: 30,
        noDifficulty: true,
        why: "the phrase that used to set `difficulty: easy` 3/3. Quick is not easy — a three-hour braise is twenty minutes of work",
    },
    {
        message: "something for dinner, nothing fancy",
        difficulty: "easy",
        noMaxMinutes: true,
        why: "the other half: SKILL with no clock in it, and inventing a ceiling would narrow the catalogue for no reason",
    },
    {
        message: "I want to cook something a bit special",
        difficulty: "medium",
        noMaxMinutes: true,
        why: "skill upward, using the phrasing the field's own description maps — 'really impressive' sits between medium and hard and is not a fair thing to pin",
    },

    // --- CUISINE: an origin is a filter, not a phrasing --------------------
    //
    // Reported 2026-09-13. "Give me an Asian dish containing eggs" returned
    // BANANA BREAD, and the reply said so out loud: "while not traditionally
    // considered an Asian dish". The CONTAINS shape caught the eggs and the
    // origin had nowhere to go — the tool had thirteen fields and none was
    // `cuisine`, while its own descriptions told the model three times to put a
    // cuisine in `query`, which is matched by similarity and filters nothing.
    //
    // Both levels are pinned because they behave differently downstream and
    // only the data makes them safe: `tag_subtree` expands `asian` to 53 tags
    // and `thai` to 1, so a region widens and a specific cuisine cannot.
    {
        message: "Give me an Asian dish containing eggs",
        cuisine: ["asian"],
        ingredients: ["egg"],
        noDish: true,
        why: "the reported turn. BOTH halves or it answers a different question — the origin narrows and the ingredient narrows, and dropping either one is how Banana Bread qualified",
    },
    {
        message: "something Thai for dinner",
        cuisine: ["thai"],
        noDish: true,
        why: "a specific cuisine, which must stay specific — `thai` has no children, so the subtree is itself and nothing widens",
    },
    {
        message: "a Sichuan noodle dish",
        cuisine: ["sichuan"],
        why: "the level the user used, not the level we would have picked — Sichuan is a leaf under east asian, and rounding it up to 'chinese' answers a broader question than was asked",
    },
    {
        message: "what's a good Middle Eastern breakfast?",
        cuisine: ["middle eastern"],
        why: "a multi-word region, and one that really is a parent — it has to reach the leaves the same way 'asian' does",
    },
    {
        message: "a chicken and rice dish",
        ingredients: ["chicken", "rice"],
        noCuisine: true,
        why: "the harder half: no origin was named, and inventing one narrows the catalogue to a subtree that may hold nothing",
    },

    // --- GOES WITH: the third relationship ---------------------------------
    //
    // Reported 2026-09-13. "What goes well with Korean chicken?" came back with
    // Korean Fried Chicken — the dish the question was about. Three causes in
    // one turn: the router had no pairing shape and reached for whatever was
    // nearest (3 different routes in 3 runs), `"side"` is not a COMPONENT_TAGS
    // value so the least-wrong route was out-of-enum, and nothing excluded the
    // anchor, so stage 1b's vector search scored the dish itself 0.602 and took
    // the only slot.
    //
    // These cases exist to hold the distinction that decides it: the named thing
    // goes INTO the pan (CONTAINS) or sits NEXT TO the plate (GOES WITH). The
    // preposition cannot tell them apart — "with" is in both.
    {
        message: "What goes well with Korean chicken?",
        pairsWith: "chicken",
        noDish: true,
        why: "the reported turn. Nobody puts Korean fried chicken inside a side dish — pairing, not containing",
    },
    {
        message: "what side dish goes with lasagne?",
        pairsWith: "lasagn",
        course: "side",
        noDish: true,
        why: "the slot is named outright, so `course` carries it — and `component` must not, since a side is a course and not a building block",
    },
    {
        message: "and a pudding to follow?",
        history: [
            { role: "user", content: "give me a lasagne recipe" },
            {
                role: "assistant",
                content: "Here's Lasagne — layered pasta with ragù and béchamel.",
            },
        ],
        course: "dessert",
        pairsWith: "lasagn",
        why: "a SYNONYM for the slot — pudding, afters and sweet all mean dessert. This sat at 1/3 in the sweep because the enum value never appears in the sentence",
    },
    {
        message: "what's a good dessert after a curry?",
        pairsWith: "curry",
        course: "dessert",
        why: "the other slot, and the one where 'after' rather than 'with' names the relationship",
    },
    {
        message: "what goes with it?",
        history: [
            { role: "user", content: "a chicken parmesan recipe" },
            {
                role: "assistant",
                content:
                    "Here's Chicken Parmesan — breaded chicken baked under tomato sauce and mozzarella.",
            },
        ],
        pairsWith: "parmesan",
        why: "the pronoun form: the anchor has to be resolved against the conversation before it can be excluded",
    },
];

const tools = convertToolsToOpenAiTools({
    GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
    PLAN_MENU: planMenuTool,
});

/** What one routing call produced: the tool it chose, its arguments, its prose. */
interface Routed extends RoutedSearch {
    /** null when the model answered the question itself instead of fetching. */
    tool: string | null;
    courses: string[];
    prose: string;
}

/** Run one routing call and return the arguments it produced. */
async function route(testCase: Case): Promise<Routed> {
    const stream = createChatCompletion(
        [
            { role: "system", content: SYSTEM_PROMPT },
            ...(testCase.history ?? []),
            { role: "user", content: testCase.message },
        ],
        tools,
        { stream: true, model: ROUTING_MODEL, temperature: 0.7 }
    );

    let prose = "";

    for await (const event of stream) {
        if (event.type === "chunk") prose += event.delta;

        if (event.type === "tool_calls") {
            const [call] = event.tool_calls;
            let courses: string[] = [];

            try {
                const args = JSON.parse(call?.function.arguments ?? "{}") as {
                    courses?: unknown;
                };

                courses = Array.isArray(args.courses)
                    ? args.courses.filter(
                          (item): item is string => typeof item === "string"
                      )
                    : [];
            } catch {
                courses = [];
            }

            return {
                tool: call?.function.name ?? null,
                courses,
                prose,
                ...readRoutedSearch(event.tool_calls),
            };
        }
    }

    // No tool call: the model answered the question itself, and the prose IS
    // the reply. Returned rather than dropped so `answerNames` can read it.
    return { tool: null, courses: [], prose };
}

const has = (values: string[] | undefined, needle: string) =>
    (values ?? []).some((value) => value.toLowerCase().includes(needle));

/**
 * Refuse to run while any case asserts only which tool was chosen.
 *
 * Checked BEFORE the first model call, so a weak case costs nothing to catch and
 * cannot be papered over by a green run. See {@link ASSERTION_KEYS}.
 */
function assertCasesAreStrong(): void {
    const weak = CASES.filter(
        (testCase) =>
            !testCase.toolOnly &&
            !ASSERTION_KEYS.some(
                (key) => (testCase as unknown as Record<string, unknown>)[key] !== undefined
            )
    );

    if (weak.length === 0) return;

    console.error(
        `${weak.length} case(s) assert only which tool was chosen, which does not check WHICH SEARCH ran:\n` +
            weak.map((testCase) => `  - "${testCase.message}"`).join("\n") +
            "\n\nThat is how \"what should I serve with roast chicken?\" stayed green" +
            " for weeks while routing to the wrong shape. Add an argument" +
            " assertion, or mark the case `toolOnly: true` if the tool really is" +
            " all it is about."
    );

    process.exit(1);
}

async function main() {
    assertCasesAreStrong();

    const repeats = Number(process.env.REPEAT ?? 1);

    let failures = 0;
    let total = 0;

    console.log(`Routing model: ${ROUTING_MODEL}\n`);

    for (const testCase of CASES) {
        for (let run = 0; run < repeats; run++) {
            total++;

            const routed = await route(testCase);
            const reasons: string[] = [];

            const wantTool = testCase.tool ?? "GET_RECIPE_SUGGESTIONS";

            if (testCase.noTool) {
                if (routed.tool) {
                    reasons.push(
                        `called ${routed.tool} with query "${routed.query ?? ""}" — this is a question to answer, not a dish to fetch`
                    );
                } else if (
                    testCase.answerNames &&
                    !routed.prose.toLowerCase().includes(testCase.answerNames)
                ) {
                    reasons.push(
                        `the answer never says "${testCase.answerNames}", so the next turn has no dish to resolve: ${JSON.stringify(routed.prose.slice(0, 160))}`
                    );
                }
            } else if (!routed.tool) {
                reasons.push("no tool call at all — the search never runs");
            } else if (routed.tool !== wantTool) {
                reasons.push(
                    `chose ${routed.tool ?? "nothing"}, must choose ${wantTool}`
                );
            } else if (wantTool === "PLAN_MENU") {
                for (const needle of testCase.courses ?? []) {
                    if (!has(routed.courses, needle)) {
                        reasons.push(`courses is missing "${needle}"`);
                    }
                }

                if (testCase.noCourses && routed.courses.length > 0) {
                    reasons.push(
                        `guessed courses [${routed.courses.join(", ")}] — the user did not say, so it must ask`
                    );
                }

                if (has(routed.courses, "main")) {
                    reasons.push(
                        "asked for a 'main' course — the main is the seed, not a slot"
                    );
                }
            } else {
                const dish = (routed.dish ?? "").toLowerCase();
                const component = (routed.component ?? "").toLowerCase();

                if (testCase.dish && !dish.includes(testCase.dish)) {
                    reasons.push(`dish "${routed.dish ?? ""}" lacks "${testCase.dish}"`);
                }

                if (testCase.noDish && dish) {
                    reasons.push(`dish was pinned to "${routed.dish}" and must not be`);
                }

                if (testCase.component && component !== testCase.component) {
                    reasons.push(
                        `component "${routed.component ?? ""}" is not "${testCase.component}"`
                    );
                }

                if (testCase.noComponent && component) {
                    reasons.push(`component "${routed.component}" was set and must not be`);
                }

                for (const needle of testCase.exclude ?? []) {
                    if (!has(routed.exclude, needle)) {
                        reasons.push(`exclude is missing "${needle}"`);
                    }
                }

                for (const needle of testCase.noExclude ?? []) {
                    if (has(routed.exclude, needle)) {
                        reasons.push(
                            `exclude contains "${needle}", the dish this turn is about — pinned and forbidden at once`
                        );
                    }
                }

                for (const needle of testCase.ingredients ?? []) {
                    if (!has(routed.ingredients, needle)) {
                        reasons.push(`ingredients is missing "${needle}"`);
                    }
                }

                // A refusal must not leave a live pin on the refused dish. Two
                // routes achieve that and both are correct; see the field's note.
                if (testCase.refusing && !routed.refusing && dish) {
                    reasons.push(
                        `dish is pinned to "${routed.dish}" and refusing was not set — the reader is turning this card down, so the pin survives and the same card comes back`
                    );
                }

                for (const needle of testCase.diet ?? []) {
                    if (!has(routed.dietaryRestrictions, needle)) {
                        reasons.push(
                            `dietaryRestrictions is missing "${needle}" — a stated exclusion that does not reach this field is not applied anywhere`
                        );
                    }
                }

                for (const needle of testCase.blacklist ?? []) {
                    if (!has(routed.blacklist, needle)) {
                        reasons.push(`blacklist is missing "${needle}"`);
                    }
                }

                if (testCase.noIngredients && (routed.ingredients ?? []).length > 0) {
                    reasons.push(
                        `ingredients ${JSON.stringify(routed.ingredients)} was set on a NEGATED request — \`ingredients\` means the dish must CONTAIN this, so it asks for exactly what was ruled out`
                    );
                }

                if (
                    testCase.maxResults !== undefined &&
                    routed.maxResults !== testCase.maxResults
                ) {
                    reasons.push(
                        `maxResults ${routed.maxResults ?? "(unset)"} is not ${testCase.maxResults} — an explicit ask for several must be carried, and an unstated one must not invent a screen of cards`
                    );
                }

                if (testCase.noMaxResults && routed.maxResults !== undefined) {
                    reasons.push(
                        `maxResults ${routed.maxResults} was set on an ordinary request — one dish is the normal answer`
                    );
                }

                if (
                    testCase.maxMinutes !== undefined &&
                    routed.maxMinutes !== testCase.maxMinutes
                ) {
                    reasons.push(
                        `maxMinutes ${routed.maxMinutes ?? "(unset)"} is not ${testCase.maxMinutes} — it is a CEILING, so rounding up offers a dish there is no time to cook`
                    );
                }

                if (testCase.noMaxMinutes && routed.maxMinutes !== undefined) {
                    reasons.push(
                        `maxMinutes ${routed.maxMinutes} was invented — no duration was stated`
                    );
                }

                if (
                    testCase.difficulty &&
                    routed.difficulty !== testCase.difficulty
                ) {
                    reasons.push(
                        `difficulty "${routed.difficulty ?? ""}" is not "${testCase.difficulty}"`
                    );
                }

                if (testCase.noDifficulty && routed.difficulty) {
                    reasons.push(
                        `difficulty "${routed.difficulty}" was set — this is about the CLOCK, not the cook; a three-hour braise is twenty minutes of work`
                    );
                }

                for (const needle of testCase.cuisine ?? []) {
                    if (!has(routed.cuisine, needle)) {
                        reasons.push(
                            `cuisine is missing "${needle}" — an origin that lives only in \`query\` filters nothing, so the turn answers with any dish at all`
                        );
                    }
                }

                if (testCase.noCuisine && (routed.cuisine ?? []).length > 0) {
                    reasons.push(
                        `cuisine ${JSON.stringify(routed.cuisine)} was set and no origin was named — it narrows the catalogue to a subtree that may hold nothing`
                    );
                }

                const pairsWith = (routed.pairsWith ?? "").toLowerCase();

                if (testCase.pairsWith && !pairsWith.includes(testCase.pairsWith)) {
                    reasons.push(
                        `pairsWith "${routed.pairsWith ?? ""}" lacks "${testCase.pairsWith}" — the anchor is what the search excludes, so an unset or wrong one lets the dish be returned as the answer to a question about it`
                    );
                }

                if (testCase.noPairsWith && pairsWith) {
                    reasons.push(
                        `pairsWith was set to "${routed.pairsWith}" — nothing is being accompanied here, and the anchor is excluded from the results`
                    );
                }

                if (testCase.course && routed.course !== testCase.course) {
                    reasons.push(
                        `course "${routed.course ?? ""}" is not "${testCase.course}"`
                    );
                }

                // A pairing turn must not ALSO route as CONTAINS: that is the
                // exact confusion this section exists for, and both fields being
                // set means the model hedged rather than chose.
                if (testCase.pairsWith && (routed.ingredients ?? []).length > 0) {
                    reasons.push(
                        `ingredients ${JSON.stringify(routed.ingredients)} was set on a PAIRING turn — the anchor sits beside the dish, it does not go into it`
                    );
                }

                if (testCase.noRefusing && routed.refusing) {
                    reasons.push(
                        "refusing was set on a FOLLOW-UP — this turn is about the dish on screen, and unpinning it answers a question nobody asked"
                    );
                }
            }

            const ok = reasons.length === 0;
            if (!ok) failures++;

            console.log(
                `${ok ? "✓" : "✗"} "${testCase.message}"\n    -> ${JSON.stringify({
                    dish: routed?.dish,
                    component: routed?.component,
                    ingredients: routed?.ingredients,
                    exclude: routed?.exclude,
                    refusing: routed?.refusing,
                    pairsWith: routed?.pairsWith,
                    course: routed?.course,
                    cuisine: routed?.cuisine,
                    dietaryRestrictions: routed?.dietaryRestrictions,
                    blacklist: routed?.blacklist,
                    maxMinutes: routed?.maxMinutes,
                    maxResults: routed?.maxResults,
                    difficulty: routed?.difficulty,
                })}${ok ? "" : `\n    ${reasons.join("; ")}\n    ${testCase.why}`}`
            );
        }
    }

    console.log(`\n${total - failures}/${total} passed`);

    if (failures > 0) {
        console.error(
            `\n${failures} routing failures on ${ROUTING_MODEL}. These do not surface as errors ` +
                `in the app — they surface as a plausible, wrong recipe. Do not ship this model.`
        );
        process.exit(1);
    }
}

void main();
