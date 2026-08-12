import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { suggestionCanonicalId } from "@fridgeezy/toolkit";
import { config } from "dotenv";

import { adjudicateSameDish } from "../modules/suggestions/services/adjudicate-suggestion";
import { describeSuggestion } from "../modules/suggestions/services/suggestion-signature";
import { verifySuggestionAuthenticity } from "../modules/suggestions/services/verify-suggestion-authenticity";

config();

/**
 * Eval harness. Exercises the two LLM decision points the suggestion pipeline
 * rests on — the dish-dedup adjudicator and the authenticity gate — against the
 * acceptance fixtures below. Hits OpenAI, so results can vary run to run; treat
 * a failure as a signal to re-check prompts/thresholds. Exits non-zero if any
 * fixture fails.
 */
interface DishFixture {
    name: string;
    /**
     * Nullable, matching `name_alt` on the real DTO. Every fixture predating the
     * scope checks happened to carry an alternate name, which made `string` look
     * sufficient — but a Mojito has no second name, and inventing an empty
     * string to satisfy the type would put a stray blank line in the descriptor
     * the model actually reads.
     */
    nameAlt: string | null;
    tags: string[];
    ingredients: string[];
}

const descriptor = (d: DishFixture): string =>
    describeSuggestion(d.name, d.nameAlt, d.tags, d.ingredients);

const toDto = (d: DishFixture): GenerateSuggestionResponseDto => ({
    name: d.name,
    name_alt: d.nameAlt,
    description: "eval fixture",
    difficulty: "medium",
    ingredients: d.ingredients,
    tags: d.tags,
});

// Same dish under different names / languages — should MERGE (adjudicate same).
const SAME_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam", nameAlt: "Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut", "tomato"] },
        { name: "Papaya Salad", nameAlt: "Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut"] },
    ],
    [
        { name: "Murgh Makhani", nameAlt: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] },
        { name: "Butter Chicken", nameAlt: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] },
    ],
    // Low-signal same-dish pairs (calibrated ~0.74–0.85) — now in the LLM gray band.
    [
        { name: "Gyōza", nameAlt: "Japanese Pan-Fried Dumplings", tags: ["japanese", "appetizer", "dish"], ingredients: ["pork", "cabbage", "garlic", "ginger", "dumpling wrapper"] },
        { name: "Japanese Dumplings", nameAlt: "Gyoza", tags: ["japanese", "appetizer", "dish"], ingredients: ["ground pork", "napa cabbage", "garlic", "ginger", "wrapper"] },
    ],
    [
        { name: "Phở Bò", nameAlt: "Vietnamese Beef Noodle Soup", tags: ["vietnamese", "soup", "dish"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "scallion", "cilantro"] },
        { name: "Pho", nameAlt: "Beef Pho", tags: ["vietnamese", "soup", "dish"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "herbs"] },
    ],
];

// Genuine variations / distinct dishes — should STAY DISTINCT (adjudicate not-same).
const DISTINCT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam Thai", nameAlt: "Thai Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] },
        { name: "Som Tam Lao", nameAlt: "Lao Green Papaya Salad", tags: ["lao", "salad", "dish"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime", "eggplant"] },
    ],
    [
        { name: "Roux", nameAlt: "Roux", tags: ["french", "roux", "component"], ingredients: ["flour", "butter"] },
        { name: "Béchamel", nameAlt: "Bechamel Sauce", tags: ["french", "sauce", "component"], ingredients: ["flour", "butter", "milk"] },
    ],
    // Near-miss distinct pairs (calibrated ~0.72–0.80) — in the LLM gray band; the
    // adjudicator must keep them apart.
    [
        { name: "Butter Chicken", nameAlt: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream", "fenugreek"] },
        { name: "Chicken Tikka Masala", nameAlt: "Chicken Tikka Masala", tags: ["indian", "main", "dish"], ingredients: ["chicken", "yogurt", "tomato", "cream", "garam masala", "onion"] },
    ],
    [
        { name: "Carbonara", nameAlt: "Spaghetti alla Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
        { name: "Cacio e Pepe", nameAlt: "Cacio e Pepe", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "pecorino", "black pepper"] },
    ],
    [
        { name: "Pad Thai", nameAlt: "Pad Thai", tags: ["thai", "main", "dish"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg", "bean sprout"] },
        { name: "Pad See Ew", nameAlt: "Pad See Ew", tags: ["thai", "main", "dish"], ingredients: ["wide rice noodle", "chicken", "soy sauce", "egg", "chinese broccoli"] },
    ],
];

/**
 * HOMOGRAPHS — one name, two genuinely different dishes, separated only by
 * cuisine and ingredients. Should STAY DISTINCT.
 *
 * These are the hardest input the adjudicator sees, and harder than
 * `DISTINCT_PAIRS` in a specific way: the canonical names are BYTE-IDENTICAL, so
 * every cue except the cuisine tag and the ingredient list says "same dish". A
 * Turkish mantı is beef in garlic yogurt; a Kazakh manti is lamb and pumpkin,
 * steamed. They are not variations of one dish, they are two dishes.
 *
 * They do not reach the adjudicator today. `findKnownDish` matches on
 * `canonical_id` alone at step 0 — before the review, with no LLM and no
 * embedding — so the second one is not merged but silently REPLACED, and a user
 * filtering cuisine=kazakh is handed a Turkish dish. Measured on the signature
 * embedding 2026-08-12 (`calibrate-thresholds`): 0.741–0.846, i.e. every pair
 * lands below HIGH and four of the five land in the gray band. So the band will
 * not auto-merge them, and THIS adjudicator is what decides.
 */
const HOMOGRAPH_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Manti", nameAlt: "Mantı", tags: ["turkish", "main", "dumpling"], ingredients: ["ground beef", "flour", "yogurt", "garlic", "butter", "paprika", "mint"] },
        { name: "Manti", nameAlt: "Mänti", tags: ["kazakh", "main", "dumpling"], ingredients: ["lamb", "pumpkin", "onion", "flour", "black pepper"] },
    ],
    [
        { name: "Tortilla", nameAlt: "Tortilla Española", tags: ["spanish", "main", "dish"], ingredients: ["potato", "egg", "onion", "olive oil"] },
        { name: "Tortilla", nameAlt: "Tortilla de Maíz", tags: ["mexican", "side", "pancake"], ingredients: ["corn masa", "water", "salt"] },
    ],
    [
        { name: "Moussaka", nameAlt: "Μουσακάς", tags: ["greek", "main", "bake"], ingredients: ["eggplant", "ground lamb", "bechamel", "tomato", "cinnamon", "potato"] },
        { name: "Moussaka", nameAlt: "Maghmour", tags: ["levantine", "appetizer", "dish"], ingredients: ["eggplant", "chickpea", "tomato", "onion", "olive oil", "garlic"] },
    ],
    [
        { name: "Empanada", nameAlt: "Empanada Criolla", tags: ["argentinian", "appetizer", "pie"], ingredients: ["ground beef", "onion", "green olive", "hard boiled egg", "cumin", "flour"] },
        { name: "Empanada", nameAlt: "Empanada Gallega", tags: ["spanish", "main", "pie"], ingredients: ["tuna", "bell pepper", "onion", "tomato", "flour", "olive oil"] },
    ],
    [
        { name: "Halva", nameAlt: "Halawa", tags: ["levantine", "dessert", "dish"], ingredients: ["tahini", "sugar", "pistachio", "vanilla"] },
        { name: "Halva", nameAlt: "Sooji Halwa", tags: ["indian", "dessert", "dish"], ingredients: ["semolina", "ghee", "sugar", "cardamom", "cashew", "raisin"] },
    ],
];

/**
 * CUISINE LABEL DRIFT — one dish, two generations, two different cuisine labels.
 * Should MERGE. This is the cost side of treating cuisine as part of identity:
 * every one of these is a row that would otherwise be split in two.
 *
 * Measured against the live dev catalogue on 2026-08-12, the drift is not the
 * one the prompt implies. `generate-suggestions-stream` asks for "as specific as
 * you can be (sichuan rather than chinese)" and the generator ignores it — 24
 * dishes carry `chinese` and none carries any Chinese regional cuisine. What has
 * actually happened is ANCESTOR drift: `Shakshuka [middle eastern]` sits beside
 * `Shakshuka with Merguez [north african]`, and Shawarma is split across
 * `levantine` and `middle eastern`.
 *
 * Signature scores 0.906–0.946, so they all clear LOW and reach this
 * adjudicator; only Ghormeh Sabzi auto-merges.
 *
 * **Vary the cuisine label and the WORDING, never the substance.** Measured
 * 2026-08-12, five runs per case, deterministic: swapping only the cuisine tag
 * merges 5/5, and re-wording the same ingredients (`eggs`/`egg`,
 * `tomatoes`/`tomato`) merges 5/5 — but giving one side harissa where the other
 * has cumin and paprika splits 5/5. That last one is the adjudicator working
 * correctly: its prompt says a regional variation differing in defining
 * ingredients is NOT the same dish, and a harissa shakshuka beside a cumin one
 * is the Som Tam Thai / Som Tam Lao case, which this catalog stores as two rows
 * on purpose.
 *
 * So a fixture that changes the spice base is not testing label drift, it is
 * testing something the pipeline already answers — and it fails here while
 * looking like a drift regression. The first version of this set made exactly
 * that mistake.
 */
const CUISINE_DRIFT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Shakshuka", nameAlt: "Shakshouka", tags: ["middle eastern", "main", "dish"], ingredients: ["egg", "tomato", "bell pepper", "onion", "harissa"] },
        { name: "Shakshuka", nameAlt: null, tags: ["north african", "main", "dish"], ingredients: ["eggs", "tomatoes", "pepper", "onion", "harissa"] },
    ],
    [
        { name: "Shawarma", nameAlt: "Shawarma Djaj", tags: ["levantine", "main", "wrap"], ingredients: ["chicken thigh", "garlic", "lemon", "flatbread", "tahini", "pickle"] },
        { name: "Shawarma", nameAlt: null, tags: ["middle eastern", "main", "wrap"], ingredients: ["chicken", "garlic sauce", "lemon juice", "pita", "tahini"] },
    ],
    [
        { name: "Mapo Tofu", nameAlt: "Mápó Dòufu", tags: ["chinese", "main", "dish"], ingredients: ["tofu", "ground pork", "doubanjiang", "sichuan peppercorn", "scallion"] },
        { name: "Mapo Tofu", nameAlt: null, tags: ["sichuan", "main", "dish"], ingredients: ["tofu", "pork", "chili bean paste", "sichuan peppercorn", "garlic"] },
    ],
    [
        { name: "Ghormeh Sabzi", nameAlt: "Qormeh Sabzi", tags: ["persian", "main", "stew"], ingredients: ["lamb", "parsley", "fenugreek", "kidney bean", "dried lime", "rice"] },
        { name: "Ghormeh Sabzi", nameAlt: null, tags: ["iranian", "main", "stew"], ingredients: ["lamb shoulder", "herbs", "fenugreek", "red bean", "dried lime"] },
    ],
];

// Attested dishes — should PASS the authenticity gate.
const AUTHENTIC_DISHES: DishFixture[] = [
    { name: "Spaghetti alla Carbonara", nameAlt: "Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
    { name: "Murgh Makhani", nameAlt: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] },
];

// Inventions / hallucinations — should be DROPPED by the authenticity gate.
const INVENTION_DISHES: DishFixture[] = [
    { name: "Carbonara with Asparagus", nameAlt: "Asparagus Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "asparagus"] },
    { name: "Zorblatt Crunch", nameAlt: "Zorblatt Crunch", tags: ["fusion", "snack", "dish"], ingredients: ["moon dust", "glitter", "cardboard"] },
];

/**
 * Real dishes with their DEFINING ingredient stripped out — almost always a
 * dietary adaptation still wearing the original's name. Should be DROPPED.
 *
 * The first fixture is verbatim the row that reached the live catalog on
 * 2026-08-05: the gate rated it "canonical" at 0.95 confidence, HIGHER than the
 * same dish with its seafood intact, because it was reading the name and not the
 * ingredient list. These are harder than the inventions above — the name, cuisine
 * and tags are all impeccable, which is exactly what hides them.
 */
const GUTTED_DISHES: DishFixture[] = [
    { name: "Peruvian Seafood Ceviche", nameAlt: "Ceviche de Mariscos", tags: ["peruvian", "appetizer", "dish"], ingredients: ["cilantro", "corn", "lime", "onion", "red chili", "salt", "sweet potato"] },
    { name: "Spaghetti alla Carbonara", nameAlt: "Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "olive oil", "nutritional yeast", "black pepper", "zucchini"] },
    { name: "Green Papaya Salad", nameAlt: "Som Tam", tags: ["thai", "salad", "dish"], ingredients: ["cabbage", "carrot", "lime", "chili", "peanut", "soy sauce"] },
];

/**
 * Drinks. Should be DROPPED as `not_food`, however real they are.
 *
 * Structurally the same trap as GUTTED_DISHES and the opposite failure: there,
 * an impeccable name hid a broken ingredient list; here, the name AND the
 * ingredients are both perfectly correct, and the item is still out of scope.
 * A gate that only asks "is this attested" rates a Mojito canonical at high
 * confidence and is right to — which is why the food test has to run before the
 * authenticity one rather than alongside it.
 *
 * Alcohol is deliberately not the axis. Half these fixtures are alcohol-free,
 * because the rule is "is its purpose to be drunk" and a virgin daiquiri fails
 * it exactly as hard as the original.
 */
const DRINKS: DishFixture[] = [
    { name: "Mojito", nameAlt: null, tags: ["cuban", "dessert", "dish"], ingredients: ["white rum", "lime", "mint", "sugar", "soda water"] },
    { name: "Virgin Piña Colada", nameAlt: null, tags: ["caribbean", "dessert", "dish"], ingredients: ["pineapple juice", "coconut cream", "ice"] },
    { name: "Mango Lassi", nameAlt: null, tags: ["indian", "dessert", "dish"], ingredients: ["mango", "yogurt", "sugar", "cardamom"] },
    { name: "Horchata", nameAlt: null, tags: ["mexican", "dessert", "dish"], ingredients: ["rice", "cinnamon", "sugar", "milk"] },
];

/**
 * Food that CONTAINS a drink. Should PASS.
 *
 * The false-positive half of the same rule, and the reason it is worth its own
 * fixture set: a gate told to reject drinks will happily reject anything with
 * wine in the ingredient list, which removes a large slice of European cooking.
 * Gazpacho and consommé are here because they are the genuinely ambiguous
 * end — poured, sometimes drunk from a cup, and still food.
 */
const FOOD_WITH_DRINK: DishFixture[] = [
    { name: "Coq au Vin", nameAlt: null, tags: ["french", "main", "stew"], ingredients: ["chicken", "red wine", "bacon", "mushroom", "onion", "thyme"] },
    { name: "Tiramisu", nameAlt: null, tags: ["italian", "dessert", "dish"], ingredients: ["mascarpone", "espresso", "marsala", "ladyfinger", "cocoa", "egg"] },
    { name: "Gazpacho", nameAlt: null, tags: ["spanish", "appetizer", "soup"], ingredients: ["tomato", "cucumber", "bell pepper", "garlic", "olive oil", "bread"] },
    { name: "Beef Consommé", nameAlt: null, tags: ["french", "appetizer", "soup"], ingredients: ["beef", "egg white", "carrot", "celery", "leek"] },
];

async function main() {
    let pass = 0;
    let fail = 0;
    const check = (label: string, actual: boolean, expected: boolean) => {
        const ok = actual === expected;
        console.log(`  ${ok ? "✓" : "✗"} ${label} (got ${actual}, want ${expected})`);
        if (ok) pass++;
        else fail++;
    };

    console.log("Dedup — should MERGE (same dish):");
    for (const [a, b] of SAME_PAIRS) {
        check(
            `${a.name} ≈ ${b.name}`,
            await adjudicateSameDish(descriptor(a), descriptor(b)),
            true
        );
    }

    console.log("\nDedup — should stay DISTINCT:");
    for (const [a, b] of DISTINCT_PAIRS) {
        check(
            `${a.name} ≠ ${b.name}`,
            await adjudicateSameDish(descriptor(a), descriptor(b)),
            false
        );
    }

    console.log("\nDedup — homographs, one name and two dishes, should stay DISTINCT:");
    for (const [a, b] of HOMOGRAPH_PAIRS) {
        check(
            `${a.name} [${a.tags[0]}] ≠ [${b.tags[0]}]`,
            await adjudicateSameDish(descriptor(a), descriptor(b)),
            false
        );
    }

    console.log("\nDedup — cuisine label drift, one dish, should MERGE:");
    for (const [a, b] of CUISINE_DRIFT_PAIRS) {
        check(
            `${a.name} [${a.tags[0]}] ≈ [${b.tags[0]}]`,
            await adjudicateSameDish(descriptor(a), descriptor(b)),
            true
        );
    }

    // Does the homograph actually COLLIDE? The gate's Step C strips a qualifier
    // that adds nothing but keeps one that "marks a genuinely different dish",
    // so it may hand back "Kazakh Manti" and disambiguate the pair by naming.
    // That is a fine outcome — but it means the pair never reaches the identity
    // key, and the assertion above would then be passing for the wrong reason:
    // green on a mechanism nothing exercised.
    //
    // Reported, not failed. Naming its way out is a legitimate answer; silently
    // believing the dedup path was tested is not.
    console.log("\nHomographs — do the canonical names still collide?");
    for (const [a, b] of HOMOGRAPH_PAIRS) {
        const [reviewA, reviewB] = await Promise.all([
            verifySuggestionAuthenticity(toDto(a)),
            verifySuggestionAuthenticity(toDto(b)),
        ]);
        // `name` comes back only when it CHANGES — absent means keep the proposal.
        const nameA = reviewA.name ?? a.name;
        const nameB = reviewB.name ?? b.name;
        const collides = suggestionCanonicalId(nameA) === suggestionCanonicalId(nameB);
        console.log(
            `  ${collides ? "→" : "·"} ${a.name}: "${nameA}" [${a.tags[0]}] vs "${nameB}" [${b.tags[0]}]` +
                `${collides ? "  COLLIDES — needs the identity key" : "  disambiguated by naming"}`
        );
    }

    console.log("\nAuthenticity — should PASS:");
    for (const d of AUTHENTIC_DISHES) {
        check(d.name, (await verifySuggestionAuthenticity(toDto(d))).authentic, true);
    }

    console.log("\nAuthenticity — should be DROPPED:");
    for (const d of INVENTION_DISHES) {
        check(d.name, (await verifySuggestionAuthenticity(toDto(d))).authentic, false);
    }

    console.log("\nAuthenticity — defining ingredient stripped, should be DROPPED:");
    for (const d of GUTTED_DISHES) {
        const review = await verifySuggestionAuthenticity(toDto(d));
        check(`${d.name} [${review.status}]`, review.authentic, false);
    }

    // Scored on the STATUS, not just on `authentic`. A drink dropped as
    // "invention" would pass an authenticity-only assertion while telling the
    // caller the wrong thing: `not_food` is what breaks the top-up loop and
    // sends the terminal rejection frame, so a right answer for the wrong
    // reason is a silent regression of the feature this fixture guards.
    console.log("\nScope — drinks, should be DROPPED as not_food:");
    for (const d of DRINKS) {
        const review = await verifySuggestionAuthenticity(toDto(d));
        check(`${d.name} [${review.status}]`, review.status === "not_food", true);
    }

    console.log("\nScope — food containing a drink, should PASS:");
    for (const d of FOOD_WITH_DRINK) {
        const review = await verifySuggestionAuthenticity(toDto(d));
        check(`${d.name} [${review.status}]`, review.authentic, true);
    }

    console.log("\n" + "=".repeat(40));
    console.log(`${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Eval failed to run:", error);
        process.exit(1);
    });
