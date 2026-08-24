// Must be the first import — the Supabase client throws on a missing
// SUPABASE_URL at *import* time, before any statement in this file would run.
import "dotenv/config";

import type { ChatMessage } from "@fridgeezy/schemas";

import {
    convertToolsToOpenAiTools,
    createChatCompletion,
    readRoutedSearch,
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
    /** Lowercased substrings, each of which some `ingredients` entry must contain. */
    ingredients?: string[];
    why: string;
}

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
    {
        message: "how do you make a roux",
        component: "roux",
        why: "its own component kind, not 'sauce'",
    },

    // --- A component as an ACCOMPANIMENT excludes what it accompanies -----
    {
        message: "what sauce goes with apple strudel",
        component: "sauce",
        exclude: ["strudel"],
        noDish: true,
        why: "without the exclusion the search matches Apple Strudel itself and returns it",
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
        message: "something Italian",
        noDish: true,
        why: "a cuisine is not a name",
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
        why: "the trap: a dish that IS a whole meal is still one dish",
    },
    {
        message: "what should I serve with roast chicken?",
        tool: "GET_RECIPE_SUGGESTIONS",
        why: "an accompaniment to a dish already chosen, not a request to plan the meal",
    },
    {
        message: "something hearty for dinner",
        tool: "GET_RECIPE_SUGGESTIONS",
        why: "an occasion is not a course count",
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
        exclude: ["parmesan"],
        why: "'it' has to be resolved against the conversation, and the dish already shown excluded",
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
        why: "every dish already shown goes in `exclude` or the same card comes back",
    },
];

const tools = convertToolsToOpenAiTools({
    GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
    PLAN_MENU: planMenuTool,
});

/** Run one routing call and return the arguments it produced. */
async function route(testCase: Case) {
    const stream = createChatCompletion(
        [
            { role: "system", content: SYSTEM_PROMPT },
            ...(testCase.history ?? []),
            { role: "user", content: testCase.message },
        ],
        tools,
        { stream: true, model: ROUTING_MODEL, temperature: 0.7 }
    );

    for await (const event of stream) {
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
                tool: call?.function.name,
                courses,
                ...readRoutedSearch(event.tool_calls),
            };
        }
    }

    return null;
}

const has = (values: string[] | undefined, needle: string) =>
    (values ?? []).some((value) => value.toLowerCase().includes(needle));

async function main() {
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

            if (!routed) {
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

                for (const needle of testCase.ingredients ?? []) {
                    if (!has(routed.ingredients, needle)) {
                        reasons.push(`ingredients is missing "${needle}"`);
                    }
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
