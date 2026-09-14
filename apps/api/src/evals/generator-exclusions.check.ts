/**
 * The exclusions a caller asks for must REACH the generator that writes the dish.
 *
 * No database, no LLM, no API key — this asserts prompt ASSEMBLY, which is where
 * the defect was. `request.exclude` was declared on the shared DTO and honoured
 * by the batch generator (`buildExistingDishesBlock`), while the single
 * generator — the one CHAT uses — dropped it: `buildSuggestionsUserPrompt`
 * renders eight filter lines and `exclude` is not one of them.
 *
 * Nothing failed. The user typed "something else", the generator wrote the same
 * dish again, dedup resolved it onto the row the caller had just excluded, and
 * `searchRecipeSuggestions` refused that row — so the turn produced no card at
 * all. A wrong answer became an empty one, which is the shape this file exists
 * to stop coming back.
 *
 * Run: `npx nx run @fridgeezy/api:check-generator-exclusions`
 */
import {
    buildExcludedDishesBlock,
    buildExistingDishesBlock,
    buildSingleSuggestionUserPrompt,
} from "../modules/suggestions/services/suggestion-prompt-blocks";

let failures = 0;
let checks = 0;

function check(what: string, condition: boolean, detail?: string): void {
    checks++;

    if (condition) {
        console.log(`  ok   ${what}`);
    } else {
        failures++;
        console.error(`  FAIL ${what}${detail ? `\n       ${detail}` : ""}`);
    }
}

function group(title: string): void {
    console.log(`\n${title}`);
}

// --- 1. The single generator carries the exclusions -----------------------

group("1. The single generator (chat) renders `exclude`");

const withExclusions = buildSingleSuggestionUserPrompt(
    { ingredients: ["recipe with béchamel"], exclude: ["Lasagne", "Béchamel"] },
    {}
);

check(
    "names every excluded dish",
    withExclusions.includes("Lasagne") && withExclusions.includes("Béchamel"),
    JSON.stringify(withExclusions)
);

check(
    "tells the model not to return them",
    /do NOT return these dishes/i.test(withExclusions),
    JSON.stringify(withExclusions)
);

check(
    "covers variations and spellings, not just the exact name",
    /variation, translation or spelling variant/i.test(withExclusions)
);

// --- 2. Empty and absent exclusions add nothing ---------------------------

group("2. No exclusions means no block");

const noExclusions = buildSingleSuggestionUserPrompt(
    { ingredients: ["carbonara"] },
    {}
);

check(
    "an absent `exclude` adds no line",
    !/do NOT return/i.test(noExclusions),
    JSON.stringify(noExclusions)
);

check(
    "an empty `exclude` adds no line",
    !/do NOT return/i.test(
        buildSingleSuggestionUserPrompt({ ingredients: ["carbonara"], exclude: [] }, {})
    )
);

check(
    "a whitespace-only name is not rendered as an exclusion",
    !/do NOT return/i.test(
        buildSingleSuggestionUserPrompt(
            { ingredients: ["carbonara"], exclude: ["  ", ""] },
            {}
        )
    )
);

// --- 3. The blocks stay distinct -----------------------------------------
//
// Three blocks now carry a list of names into a generator prompt and the WORDING
// is the whole difference. Collapsing them is the tempting simplification and it
// would be wrong: telling the model a dish was "rejected for not being an
// established dish" when the user merely said "something else" steers the next
// generation away from a whole shape of answer for no reason, and telling it a
// refused dish is "already in the catalog" says nothing about the refusal.

group("3. Exclusion, catalogue and rejection stay three different statements");

const excluded = buildExcludedDishesBlock(["Lasagne"]);
const existing = buildExistingDishesBlock(["Lasagne"]);

check("the exclusion block is not the catalogue block", excluded !== existing);

check(
    "the catalogue block still says 'already in the catalog'",
    /already in the catalog/i.test(existing)
);

check(
    "the exclusion block does NOT claim the dish is in the catalogue",
    !/already in the catalog/i.test(excluded),
    JSON.stringify(excluded)
);

check(
    "the exclusion block does NOT claim the dish was rejected as unestablished",
    !/not established/i.test(excluded),
    JSON.stringify(excluded)
);

// --- 4. Exclusions and a rejection can hold at once -----------------------
//
// A turn can both refuse a dish the reader has seen AND retry past a notability
// drop. The two lists are independent and both have to survive.

group("4. Exclusions coexist with a notability retry");

const both = buildSingleSuggestionUserPrompt(
    { ingredients: ["brussels sprouts"], exclude: ["Roasted Brussels Sprouts"] },
    {},
    ["Brussels Sprouts Bourguignon"]
);

check(
    "the excluded dish survives",
    both.includes("Roasted Brussels Sprouts")
);

check(
    "the rejected dish survives",
    both.includes("Brussels Sprouts Bourguignon")
);

check(
    "they are rendered as two separate statements",
    /do NOT return these dishes/i.test(both) && /Rejected on this request/i.test(both)
);

// --- 5. A pinned dish still leads ----------------------------------------

group("5. A pinned dish still leads the prompt");

const pinned = buildSingleSuggestionUserPrompt(
    { ingredients: [], exclude: ["Lasagne"] },
    { dish: "Béchamel" }
);

check("the Dish line is present", pinned.startsWith("Dish: Béchamel"));

check(
    "the exclusion follows it rather than replacing it",
    pinned.indexOf("Dish: Béchamel") < pinned.indexOf("Lasagne")
);

// --- 6. Deduplication ------------------------------------------------------

group("6. Repeated names are listed once");

const repeated = buildExcludedDishesBlock(["Lasagne", "lasagne", " Lasagne "]);

check(
    "case and whitespace variants collapse to one entry",
    (repeated.match(/[Ll]asagne/g) ?? []).length === 1,
    JSON.stringify(repeated)
);

// --- summary ---------------------------------------------------------------

console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`
);

if (failures > 0) process.exit(1);
