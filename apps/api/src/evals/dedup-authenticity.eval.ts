import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { suggestionCanonicalId } from "@fridgeezy/toolkit";
import { config } from "dotenv";

import { adjudicateSameDish } from "../modules/suggestions/services/adjudicate-suggestion";
import { describeSuggestion } from "../modules/suggestions/services/suggestion-signature";
import {
    classifySuggestionAuthenticity,
    verifySuggestionAuthenticity,
} from "../modules/suggestions/services/verify-suggestion-authenticity";

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
        { name: "Som Tam", nameAlt: "Green Papaya Salad", tags: ["thai", "salad"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut", "tomato"] },
        { name: "Papaya Salad", nameAlt: "Green Papaya Salad", tags: ["thai", "salad"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut"] },
    ],
    [
        { name: "Murgh Makhani", nameAlt: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] },
        { name: "Butter Chicken", nameAlt: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream"] },
    ],
    // Low-signal same-dish pairs (calibrated ~0.74–0.85) — now in the LLM gray band.
    [
        { name: "Gyōza", nameAlt: "Japanese Pan-Fried Dumplings", tags: ["japanese", "appetizer"], ingredients: ["pork", "cabbage", "garlic", "ginger", "dumpling wrapper"] },
        { name: "Japanese Dumplings", nameAlt: "Gyoza", tags: ["japanese", "appetizer"], ingredients: ["ground pork", "napa cabbage", "garlic", "ginger", "wrapper"] },
    ],
    [
        { name: "Phở Bò", nameAlt: "Vietnamese Beef Noodle Soup", tags: ["vietnamese", "soup"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "scallion", "cilantro"] },
        { name: "Pho", nameAlt: "Beef Pho", tags: ["vietnamese", "soup"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "herbs"] },
    ],
];

// Genuine variations / distinct dishes — should STAY DISTINCT (adjudicate not-same).
const DISTINCT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam Thai", nameAlt: "Thai Green Papaya Salad", tags: ["thai", "salad"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] },
        { name: "Som Tam Lao", nameAlt: "Lao Green Papaya Salad", tags: ["lao", "salad"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime", "eggplant"] },
    ],
    [
        { name: "Roux", nameAlt: "Roux", tags: ["french", "roux", "component"], ingredients: ["flour", "butter"] },
        { name: "Béchamel", nameAlt: "Bechamel Sauce", tags: ["french", "sauce", "component"], ingredients: ["flour", "butter", "milk"] },
    ],
    // Near-miss distinct pairs (calibrated ~0.72–0.80) — in the LLM gray band; the
    // adjudicator must keep them apart.
    [
        { name: "Butter Chicken", nameAlt: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream", "fenugreek"] },
        { name: "Chicken Tikka Masala", nameAlt: "Chicken Tikka Masala", tags: ["indian", "main"], ingredients: ["chicken", "yogurt", "tomato", "cream", "garam masala", "onion"] },
    ],
    [
        { name: "Carbonara", nameAlt: "Spaghetti alla Carbonara", tags: ["italian", "main"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
        { name: "Cacio e Pepe", nameAlt: "Cacio e Pepe", tags: ["italian", "main"], ingredients: ["spaghetti", "pecorino", "black pepper"] },
    ],
    [
        { name: "Pad Thai", nameAlt: "Pad Thai", tags: ["thai", "main"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg", "bean sprout"] },
        { name: "Pad See Ew", nameAlt: "Pad See Ew", tags: ["thai", "main"], ingredients: ["wide rice noodle", "chicken", "soy sauce", "egg", "chinese broccoli"] },
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
        { name: "Tortilla", nameAlt: "Tortilla Española", tags: ["spanish", "main"], ingredients: ["potato", "egg", "onion", "olive oil"] },
        { name: "Tortilla", nameAlt: "Tortilla de Maíz", tags: ["mexican", "side", "pancake"], ingredients: ["corn masa", "water", "salt"] },
    ],
    [
        { name: "Moussaka", nameAlt: "Μουσακάς", tags: ["greek", "main", "bake"], ingredients: ["eggplant", "ground lamb", "bechamel", "tomato", "cinnamon", "potato"] },
        { name: "Moussaka", nameAlt: "Maghmour", tags: ["levantine", "appetizer"], ingredients: ["eggplant", "chickpea", "tomato", "onion", "olive oil", "garlic"] },
    ],
    [
        { name: "Empanada", nameAlt: "Empanada Criolla", tags: ["argentinian", "appetizer", "pie"], ingredients: ["ground beef", "onion", "green olive", "hard boiled egg", "cumin", "flour"] },
        { name: "Empanada", nameAlt: "Empanada Gallega", tags: ["spanish", "main", "pie"], ingredients: ["tuna", "bell pepper", "onion", "tomato", "flour", "olive oil"] },
    ],
    [
        { name: "Halva", nameAlt: "Halawa", tags: ["levantine", "dessert"], ingredients: ["tahini", "sugar", "pistachio", "vanilla"] },
        { name: "Halva", nameAlt: "Sooji Halwa", tags: ["indian", "dessert"], ingredients: ["semolina", "ghee", "sugar", "cardamom", "cashew", "raisin"] },
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
        { name: "Shakshuka", nameAlt: "Shakshouka", tags: ["middle eastern", "main"], ingredients: ["egg", "tomato", "bell pepper", "onion", "harissa"] },
        { name: "Shakshuka", nameAlt: null, tags: ["north african", "main"], ingredients: ["eggs", "tomatoes", "pepper", "onion", "harissa"] },
    ],
    [
        { name: "Shawarma", nameAlt: "Shawarma Djaj", tags: ["levantine", "main", "wrap"], ingredients: ["chicken thigh", "garlic", "lemon", "flatbread", "tahini", "pickle"] },
        { name: "Shawarma", nameAlt: null, tags: ["middle eastern", "main", "wrap"], ingredients: ["chicken", "garlic sauce", "lemon juice", "pita", "tahini"] },
    ],
    [
        { name: "Mapo Tofu", nameAlt: "Mápó Dòufu", tags: ["chinese", "main"], ingredients: ["tofu", "ground pork", "doubanjiang", "sichuan peppercorn", "scallion"] },
        { name: "Mapo Tofu", nameAlt: null, tags: ["sichuan", "main"], ingredients: ["tofu", "pork", "chili bean paste", "sichuan peppercorn", "garlic"] },
    ],
    [
        { name: "Ghormeh Sabzi", nameAlt: "Qormeh Sabzi", tags: ["persian", "main", "stew"], ingredients: ["lamb", "parsley", "fenugreek", "kidney bean", "dried lime", "rice"] },
        { name: "Ghormeh Sabzi", nameAlt: null, tags: ["iranian", "main", "stew"], ingredients: ["lamb shoulder", "herbs", "fenugreek", "red bean", "dried lime"] },
    ],
];

// Attested dishes — should PASS the authenticity gate.
const AUTHENTIC_DISHES: DishFixture[] = [
    { name: "Spaghetti alla Carbonara", nameAlt: "Carbonara", tags: ["italian", "main"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
    { name: "Murgh Makhani", nameAlt: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream"] },
];

// Inventions / hallucinations — should be DROPPED by the authenticity gate.
const INVENTION_DISHES: DishFixture[] = [
    { name: "Carbonara with Asparagus", nameAlt: "Asparagus Carbonara", tags: ["italian", "main"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "asparagus"] },
    { name: "Zorblatt Crunch", nameAlt: "Zorblatt Crunch", tags: ["fusion", "snack"], ingredients: ["moon dust", "glitter", "cardboard"] },
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
 *
 * **The first fixture is flaky, and it is not a symptom of whatever you just
 * changed.** Measured 2026-08-18, six runs each side of the cuisine-naming
 * change: it escaped as `well_known` 1/6 both before and after, and the misses
 * scatter across `obscure`, `invention` and `well_known`. So a red line here on
 * a single run is one sample of a ~1-in-6, not evidence — re-run it before
 * reaching for the prompt. It is kept as a hard fixture on purpose; the rate is
 * the thing to watch, not any one result.
 */
const GUTTED_DISHES: DishFixture[] = [
    { name: "Peruvian Seafood Ceviche", nameAlt: "Ceviche de Mariscos", tags: ["peruvian", "appetizer"], ingredients: ["cilantro", "corn", "lime", "onion", "red chili", "salt", "sweet potato"] },
    { name: "Spaghetti alla Carbonara", nameAlt: "Carbonara", tags: ["italian", "main"], ingredients: ["spaghetti", "olive oil", "nutritional yeast", "black pepper", "zucchini"] },
    { name: "Green Papaya Salad", nameAlt: "Som Tam", tags: ["thai", "salad"], ingredients: ["cabbage", "carrot", "lime", "chili", "peanut", "soy sauce"] },
    // The NAMING escape, which the three above do not cover: they all arrive
    // wearing the authentic name, so only TEST ONE has to hold. This one arrives
    // honestly labelled, and the risk is the opposite — that an adaptation which
    // ADMITS to being one reads as a legitimate named dish, minting a permanent
    // second row beside Pad Thai instead of being dropped.
    //
    // Prompted by a --repeat=5 baseline run on 2026-08-14 that renamed the same
    // dish both ways within one run: "Pad Thai" -> "Vegan Pad Thai" and
    // "Pad Thai (Vegan)" -> "Pad Thai". Step 2C strips redundant qualifiers
    // ("Apple Tarte Tatin" -> "Tarte Tatin"), and a dietary qualifier is not
    // redundant; it now has an explicit carve-out.
    //
    // NOT PAIRED with a plain-named "Pad Thai", though that was the first
    // instinct. Measured over five runs it split 2 adaptation / 3 well_known —
    // a coin flip, because the assertion is genuinely contested: tofu Pad Thai is
    // ordinary Thai street food sold as Pad Thai, and tamarind, rice noodle,
    // peanut and bean sprout all survive the swap. That is nothing like ceviche
    // without seafood. The plain-name direction is already covered above by the
    // vegan Spaghetti alla Carbonara, where the swap is unambiguous and the
    // result is stable — and a 50/50 fixture in a suite that gates model
    // migrations is worse than no fixture, because it teaches people to ignore a
    // red line.
    { name: "Vegan Pad Thai", nameAlt: null, tags: ["thai", "main", "noodles"], ingredients: ["rice noodle", "tofu", "soy sauce", "tamarind", "peanut", "bean sprout", "lime"] },
];

/**
 * Dishes that are authentically vegan or vegetarian. Should PASS.
 *
 * The false-positive half of the dietary rule TEST ONE gained on 2026-08-14, and
 * it exists for the same reason FOOD_WITH_DRINK does below: a gate told to treat
 * "the defining ingredient was swapped for a plant one" as an adaptation can
 * overshoot into treating *any* meatless dish as an adaptation of some meat dish
 * it never came from. That would quietly delete a large slice of Indian, Levantine
 * and Ethiopian cooking from discovery — and it would do it invisibly, since a
 * dish that is never suggested produces no error.
 *
 * None of these is "a vegan version" of anything. Nobody removed meat from a Dal.
 * They are dishes, named in their own right, that happen to contain no animal
 * products — which is exactly the distinction the rule asks the model to make.
 */
const AUTHENTICALLY_VEGAN: DishFixture[] = [
    { name: "Baba Ganoush", nameAlt: null, tags: ["levantine", "appetizer"], ingredients: ["eggplant", "tahini", "lemon", "garlic", "olive oil"] },
    { name: "Dal Tadka", nameAlt: null, tags: ["indian", "main"], ingredients: ["lentil", "cumin", "turmeric", "garlic", "tomato", "ghee"] },
    { name: "Aloo Gobi", nameAlt: null, tags: ["indian", "main"], ingredients: ["potato", "cauliflower", "turmeric", "cumin", "ginger", "coriander"] },
    { name: "Falafel", nameAlt: null, tags: ["levantine", "appetizer"], ingredients: ["chickpea", "parsley", "cumin", "garlic", "coriander"] },
    { name: "Misir Wot", nameAlt: null, tags: ["ethiopian", "main"], ingredients: ["red lentil", "berbere", "onion", "garlic", "ginger"] },
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
 *
 * ## The last three are REAL escapes — keep them
 *
 * Same standing instruction as GUTTED_DISHES. These three are not invented
 * probes: they are the rows that actually reached the dev catalogue on
 * 2026-08-02, replayed here exactly as they were stored, and they sat there
 * until 2026-08-14. The gate that would have stopped them (`not_food` +
 * FOOD_ONLY_RULE) landed on 2026-08-06, four days after they were written, so
 * they were never evidence of a live leak — but they ARE evidence of what this
 * gate is asked to catch in production rather than in a fixture author's
 * imagination.
 *
 * Each covers a trap the four above do not:
 *
 *  - `Té de Maguey` is a SIMMERED HERBAL INFUSION, and the hardest of the three.
 *    Everything about its process reads as cooking — leaves simmered with
 *    cinnamon and piloncillo — which puts it directly against the soup/consommé
 *    carve-out in FOOD_WITH_DRINK below that must keep passing. A gate tuned to
 *    reject this by its method rather than its purpose will start rejecting
 *    Gazpacho and Beef Consommé, so the two sets have to be read together.
 *  - `Pulque` is a FERMENTED SAP with a one-item ingredient list. Nothing in it
 *    looks like a cocktail, and there is no preparation to judge.
 *  - `Agave Margarita` is the one that carried a CORRECT COURSE TAG. It was
 *    stored as `appetizer`, which is what makes it dangerous: a well-formed row
 *    passes every structural check the pipeline makes, so the only thing standing
 *    between it and the catalogue is this gate reading its purpose.
 */
const DRINKS: DishFixture[] = [
    { name: "Mojito", nameAlt: null, tags: ["cuban", "dessert"], ingredients: ["white rum", "lime", "mint", "sugar", "soda water"] },
    { name: "Virgin Piña Colada", nameAlt: null, tags: ["caribbean", "dessert"], ingredients: ["pineapple juice", "coconut cream", "ice"] },
    { name: "Mango Lassi", nameAlt: null, tags: ["indian", "dessert"], ingredients: ["mango", "yogurt", "sugar", "cardamom"] },
    { name: "Horchata", nameAlt: null, tags: ["mexican", "dessert"], ingredients: ["rice", "cinnamon", "sugar", "milk"] },
    // Escaped into the dev catalogue 2026-08-02, removed 2026-08-14. See above.
    { name: "Té de Maguey", nameAlt: null, tags: ["mexican"], ingredients: ["agave leaf", "cinnamon", "piloncillo"] },
    { name: "Pulque", nameAlt: null, tags: ["mexican"], ingredients: ["agave sap"] },
    { name: "Agave Margarita", nameAlt: null, tags: ["mexican", "appetizer"], ingredients: ["agave", "lime juice", "salt", "tequila", "triple sec"] },
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
    { name: "Tiramisu", nameAlt: null, tags: ["italian", "dessert"], ingredients: ["mascarpone", "espresso", "marsala", "ladyfinger", "cocoa", "egg"] },
    { name: "Gazpacho", nameAlt: null, tags: ["spanish", "appetizer", "soup"], ingredients: ["tomato", "cucumber", "bell pepper", "garlic", "olive oil", "bread"] },
    { name: "Beef Consommé", nameAlt: null, tags: ["french", "appetizer", "soup"], ingredients: ["beef", "egg white", "carrot", "celery", "leek"] },
];

/**
 * Names wearing a cuisine word that is a LABEL rather than part of the name.
 * The gate should hand each one back without it.
 *
 * The card prints the cuisine as an eyebrow directly above the title, so these
 * spend a third of their width saying what the reader is already looking at.
 * The first two are verbatim rows from the dev catalogue on 2026-08-18, which is
 * what prompted the rule.
 *
 * Scored on the ABSENCE OF THE WORD, not on an expected string: the gate is
 * entitled to reword a name for other reasons at the same time (that is what
 * Step A is for), and pinning the whole string would fail on a rewrite that
 * obeyed this rule perfectly. Run against `classifySuggestionAuthenticity`
 * rather than the gate, because a dish dropped as `obscure` never reaches the
 * naming path and would silently score as a pass.
 */
const CUISINE_LABELLED: Array<{ dish: DishFixture; cuisineWord: string }> = [
    { cuisineWord: "thai", dish: { name: "Spicy Thai Cabbage Salad", nameAlt: null, tags: ["thai", "salad"], ingredients: ["cabbage", "chili", "lime", "fish sauce", "peanut", "shallot"] } },
    { cuisineWord: "chinese", dish: { name: "Chinese Smashed Cucumber Salad", nameAlt: "Pai Huang Gua", tags: ["chinese", "appetizer"], ingredients: ["cucumber", "garlic", "black vinegar", "sesame oil", "soy sauce"] } },
    { cuisineWord: "indian", dish: { name: "Indian Butter Chicken", nameAlt: "Murgh Makhani", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] } },
    { cuisineWord: "mexican", dish: { name: "Mexican Chicken Tinga", nameAlt: "Tinga de Pollo", tags: ["mexican", "main"], ingredients: ["chicken", "chipotle", "tomato", "onion", "oregano"] } },
    // The calibration fixture. English menus DO list this one as "Thai Fried
    // Rice", and the rule still strips it — "an English menu would print the
    // origin" is true of half the catalogue, so it is not the test. The word
    // stays only when the remainder stops naming the dish. Deleting this
    // fixture is how the rule drifts back to keeping every demonym a menu uses.
    { cuisineWord: "thai", dish: { name: "Thai Fried Rice", nameAlt: "Khao Pad", tags: ["thai", "main"], ingredients: ["jasmine rice", "egg", "fish sauce", "shallot", "lime", "chinese broccoli"] } },
];

/**
 * Names where the cuisine word IS the name. The gate must leave it alone.
 *
 * The false-positive half, and the reason the rule is a test rather than "strip
 * the demonym": three of these four are unrecognisable without it, and
 * "Som Tam Thai" without its last word is the LAO dish.
 *
 * "Vietnamese Spring Rolls" is the load-bearing one. Its cuisine word survives
 * for a different reason than the others — the name is a translation, and the
 * bare remainder names the fried Chinese roll instead. A gate that strips it is
 * obeying the rule's letter and merging two dishes.
 */
const CUISINE_IN_NAME: Array<{ dish: DishFixture; cuisineWord: string }> = [
    { cuisineWord: "thai", dish: { name: "Pad Thai", nameAlt: null, tags: ["thai", "main"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg", "bean sprout"] } },
    { cuisineWord: "french", dish: { name: "French Onion Soup", nameAlt: "Soupe à l'Oignon", tags: ["french", "appetizer", "soup"], ingredients: ["onion", "beef stock", "gruyère", "baguette", "butter"] } },
    { cuisineWord: "thai", dish: { name: "Som Tam Thai", nameAlt: "Thai Green Papaya Salad", tags: ["thai", "salad"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] } },
    { cuisineWord: "vietnamese", dish: { name: "Vietnamese Spring Rolls", nameAlt: "Gỏi Cuốn", tags: ["vietnamese", "appetizer"], ingredients: ["rice paper", "shrimp", "pork belly", "rice vermicelli", "mint", "lettuce"] } },
    // The cuisine word here belongs to an INGREDIENT, and the dish is Thai
    // regardless. Chinese broccoli is gai lan — a different vegetable, not
    // broccoli with a flag on it — so stripping the word changes what is
    // cooked. Caught in the 2026-08-18 backfill dry run, where the model
    // proposed exactly that edit and it was a clean single-token deletion, so
    // no structural guard could refuse it.
    { cuisineWord: "chinese", dish: { name: "Crispy Pork with Chinese Broccoli", nameAlt: null, tags: ["thai", "main"], ingredients: ["pork belly", "chinese broccoli", "garlic", "oyster sauce", "chili"] } },
];

/**
 * Whole-word match, so "thai" does not fire on "Thailand" and — the one that
 * matters — "french" does not fire on a name that merely contains the letters.
 */
const hasWord = (name: string, word: string): boolean =>
    ` ${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `.includes(
        ` ${word} `
    );

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

    // Does the homograph actually COLLIDE? It is supposed to. Step C used to be
    // free to hand back "Kazakh Manti" and disambiguate the pair by naming, and
    // that was recorded here as a fine outcome; since the cuisine rule landed on
    // 2026-08-18 it is the opposite — the step is told never to ADD a cuisine
    // word, precisely because two cuisines are allowed to share a name and the
    // identity key `(canonical_id, identity_cuisine)` is what separates them.
    //
    // So a "disambiguated by naming" line now means one of two things, both
    // worth looking at: the gate added a word it was told not to, or the pair
    // never reaches the identity key at all — in which case the assertion above
    // is green on a mechanism nothing exercised.
    //
    // Still reported rather than failed. The gate is also entitled to rename a
    // dish for unrelated reasons, and a fixture that fails on any rename would
    // fail for the wrong reason; CUISINE_LABELLED below is where the rule itself
    // is asserted.
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
                `${collides ? "  COLLIDES — needs the identity key" : "  disambiguated by naming — should not happen"}`
        );
    }

    console.log("\nNaming — a cuisine LABEL, should be stripped:");
    for (const { dish, cuisineWord } of CUISINE_LABELLED) {
        const verdict = await classifySuggestionAuthenticity(toDto(dish));
        const named = verdict.name ?? dish.name;
        check(
            `${dish.name} -> "${named}" [${verdict.status}]`,
            hasWord(named, cuisineWord),
            false
        );
    }

    console.log("\nNaming — a cuisine word that IS the name, should be kept:");
    for (const { dish, cuisineWord } of CUISINE_IN_NAME) {
        const verdict = await classifySuggestionAuthenticity(toDto(dish));
        const named = verdict.name ?? dish.name;
        check(
            `${dish.name} -> "${named}" [${verdict.status}]`,
            hasWord(named, cuisineWord),
            true
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

    console.log(
        "\nAuthenticity — authentically vegan/vegetarian dishes, should PASS:"
    );
    for (const d of AUTHENTICALLY_VEGAN) {
        const review = await verifySuggestionAuthenticity(toDto(d));
        check(`${d.name} [${review.status}]`, review.authentic, true);
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
