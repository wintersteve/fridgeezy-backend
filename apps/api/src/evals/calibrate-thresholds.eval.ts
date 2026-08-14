import { generateEmbedding } from "@fridgeezy/openai";
import { buildSuggestionSignature } from "@fridgeezy/toolkit";
import { config } from "dotenv";

import {
    SIGNATURE_HIGH_THRESHOLD,
    SIGNATURE_LOW_THRESHOLD,
} from "../modules/suggestions/services/suggestion-signature";

config();

/**
 * Threshold calibration. Measures the actual signature-embedding cosine
 * similarity for known same-dish and different-dish pairs, so
 * SIGNATURE_HIGH_THRESHOLD / SIGNATURE_LOW_THRESHOLD in
 * persist-or-reuse-suggestion can be set from real score distributions instead of
 * guessed. Prints both distributions and a suggested band. Re-run this rather
 * than hand-nudging the constants — a nudge unfits them from the distribution.
 *
 * Every fixture pair here is deliberately CROSS-NAME — the hard case. The
 * signature keys on the canonical `name` rather than a shared
 * `name_en`, so these no longer get a free ride from an identical English key and
 * have to match on name + tags + ingredients. Last run 2026-07-31: same-dish
 * 0.77–0.84, different-dish 0.63–0.80, still overlapping.
 *
 * Do NOT read the same-dish max as the ceiling for real traffic: two suggestions
 * for one dish normally now agree on the canonical name and score ~1.00, which is
 * what SIGNATURE_HIGH_THRESHOLD is set for. These fixtures measure the floor.
 *
 * ## The third section is a different question
 *
 * `HOMOGRAPH_PAIRS` / `CUISINE_DRIFT_PAIRS` / `LABEL_ONLY_PAIRS` do NOT feed the
 * suggested band, and must not be folded into the two above. The first two
 * sections FIT the thresholds; these three ASK whether the fitted thresholds
 * already answer a question the pipeline currently cannot — can the signature
 * tell two dishes that share a name apart by their cuisine alone?
 *
 * Putting a homograph in `DIFFERENT_PAIRS` would be actively misleading: if
 * Manti/Manti scores 0.95 the arithmetic below would suggest HIGH ≈ 0.96, and
 * raising HIGH to separate two dishes whose names are byte-identical is exactly
 * the nudge the note in `suggestion-signature.ts` warns against. A homograph the
 * band cannot separate is a case for a different MECHANISM, not a different
 * number. So they are scored against the SHIPPED thresholds and reported as a
 * verdict, not as an input.
 */
interface DishFixture {
    name: string;
    tags: string[];
    ingredients: string[];
}

const sig = (d: DishFixture) =>
    buildSuggestionSignature({
        name: d.name,
        tags: d.tags,
        ingredients: d.ingredients,
    });

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Same dish, different names/languages — SHOULD score high (auto-merge).
const SAME_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam", tags: ["thai", "salad"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut", "tomato"] },
        { name: "Papaya Salad", tags: ["thai", "salad"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut"] },
    ],
    [
        { name: "Murgh Makhani", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] },
        { name: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream"] },
    ],
    [
        { name: "Phở Bò", tags: ["vietnamese", "soup"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "scallion", "cilantro"] },
        { name: "Pho", tags: ["vietnamese", "soup"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "herbs"] },
    ],
    [
        { name: "Gyōza", tags: ["japanese", "appetizer"], ingredients: ["pork", "cabbage", "garlic", "ginger", "dumpling wrapper"] },
        { name: "Japanese Dumplings", tags: ["japanese", "appetizer"], ingredients: ["ground pork", "napa cabbage", "garlic", "ginger", "wrapper"] },
    ],
];

// Distinct dishes (incl. hard near-miss pairs) — SHOULD stay below the merge band.
const DIFFERENT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam Thai", tags: ["thai", "salad"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] },
        { name: "Som Tam Lao", tags: ["lao", "salad"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime", "eggplant"] },
    ],
    [
        { name: "Butter Chicken", tags: ["indian", "main"], ingredients: ["chicken", "tomato", "butter", "cream", "fenugreek"] },
        { name: "Chicken Tikka Masala", tags: ["indian", "main"], ingredients: ["chicken", "yogurt", "tomato", "cream", "garam masala", "onion"] },
    ],
    [
        { name: "Carbonara", tags: ["italian", "main"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
        { name: "Cacio e Pepe", tags: ["italian", "main"], ingredients: ["spaghetti", "pecorino", "black pepper"] },
    ],
    [
        { name: "Pad Thai", tags: ["thai", "main"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg", "bean sprout"] },
        { name: "Pad See Ew", tags: ["thai", "main"], ingredients: ["wide rice noodle", "chicken", "soy sauce", "egg", "chinese broccoli"] },
    ],
    [
        { name: "Roux", tags: ["french", "roux", "component"], ingredients: ["flour", "butter"] },
        { name: "Béchamel", tags: ["french", "sauce", "component"], ingredients: ["flour", "butter", "milk"] },
    ],
];

/**
 * HOMOGRAPHS — one name, two genuinely different dishes, told apart only by
 * cuisine and ingredients. These MUST stay distinct.
 *
 * They are harder than `DIFFERENT_PAIRS` in one specific way: the canonical
 * names are BYTE-IDENTICAL, so every cue except the cuisine tag and the
 * ingredient list says "same dish". That also means they never reach the band
 * today — `findKnownDish` matches on `canonical_id` alone at step 0, before the
 * review, and returns the stored row with no LLM and no embedding. The second
 * Manti is not merged, it is silently REPLACED, and a user filtering
 * cuisine=kazakh is handed a Turkish dish.
 *
 * What this section measures is whether the ALREADY-CALIBRATED band would
 * separate them if they were allowed to reach it:
 *
 * - every pair below HIGH -> it would. Making dish identity (name, cuisine) then
 *   needs no new adjudication call and no new prompt: a name hit under an
 *   incompatible cuisine simply stops short-circuiting and falls through to the
 *   signature layer, which already knows the answer.
 * - any pair at or above HIGH -> the band auto-merges a homograph, and only an
 *   explicit adjudication on the exact-name path can save it.
 *
 * Tortilla is deliberately the extreme: a potato omelette and a flatbread share
 * nothing but four letters. It calibrates the floor of what the signature can
 * do. Manti is the realistic one — same form, same course, ~40% ingredient
 * overlap — and is the pair to read the verdict off.
 */
const HOMOGRAPH_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Manti", tags: ["turkish", "main", "dumpling"], ingredients: ["ground beef", "flour", "yogurt", "garlic", "butter", "paprika", "mint"] },
        { name: "Manti", tags: ["kazakh", "main", "dumpling"], ingredients: ["lamb", "pumpkin", "onion", "flour", "black pepper"] },
    ],
    [
        { name: "Tortilla", tags: ["spanish", "main"], ingredients: ["potato", "egg", "onion", "olive oil"] },
        { name: "Tortilla", tags: ["mexican", "side", "pancake"], ingredients: ["corn masa", "water", "salt"] },
    ],
    [
        { name: "Moussaka", tags: ["greek", "main", "bake"], ingredients: ["eggplant", "ground lamb", "bechamel", "tomato", "cinnamon", "potato"] },
        { name: "Moussaka", tags: ["levantine", "appetizer"], ingredients: ["eggplant", "chickpea", "tomato", "onion", "olive oil", "garlic"] },
    ],
    [
        { name: "Empanada", tags: ["argentinian", "appetizer", "pie"], ingredients: ["ground beef", "onion", "green olive", "hard boiled egg", "cumin", "flour"] },
        { name: "Empanada", tags: ["spanish", "main", "pie"], ingredients: ["tuna", "bell pepper", "onion", "tomato", "flour", "olive oil"] },
    ],
    [
        { name: "Halva", tags: ["levantine", "dessert"], ingredients: ["tahini", "sugar", "pistachio", "vanilla"] },
        { name: "Halva", tags: ["indian", "dessert"], ingredients: ["semolina", "ghee", "sugar", "cardamom", "cashew", "raisin"] },
    ],
];

/**
 * CUISINE LABEL DRIFT — one dish, two generations, two different cuisine labels.
 * These MUST merge, and they are the cost side of making cuisine part of dish
 * identity: every one of them is a row that would be split in two.
 *
 * Measured against the live dev catalogue on 2026-08-12, the drift is NOT the
 * one the prompt implies. `generate-suggestions-stream` asks for "as specific as
 * you can be (sichuan rather than chinese)" and the generator ignores it — 24
 * dishes carry `chinese` and ZERO carry any Chinese regional cuisine, so the
 * sibling case (Mapo Tofu) has never actually occurred. What has occurred is
 * ANCESTOR drift, twice: `Shakshuka [middle eastern]` sits beside `Shakshuka
 * with Merguez [north african]`, and Shawarma is split across `levantine` and
 * `middle eastern`.
 *
 * That distinction decides how much machinery is needed. Ancestor drift is
 * resolvable for free and with no LLM — `tag_subtree` already answers "is one of
 * these a descendant of the other" — so if these score below LOW the ancestor
 * check is load-bearing rather than an optimisation, and has to merge BEFORE the
 * band ever runs.
 */
const CUISINE_DRIFT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Shakshuka", tags: ["middle eastern", "main"], ingredients: ["egg", "tomato", "bell pepper", "onion", "cumin", "paprika"] },
        { name: "Shakshuka", tags: ["north african", "main"], ingredients: ["eggs", "tomatoes", "pepper", "onion", "harissa"] },
    ],
    [
        { name: "Shawarma", tags: ["levantine", "main", "wrap"], ingredients: ["chicken thigh", "garlic", "lemon", "flatbread", "tahini", "pickle"] },
        { name: "Shawarma", tags: ["middle eastern", "main", "wrap"], ingredients: ["chicken", "garlic sauce", "lemon juice", "pita", "tahini"] },
    ],
    [
        { name: "Mapo Tofu", tags: ["chinese", "main"], ingredients: ["tofu", "ground pork", "doubanjiang", "sichuan peppercorn", "scallion"] },
        { name: "Mapo Tofu", tags: ["sichuan", "main"], ingredients: ["tofu", "pork", "chili bean paste", "sichuan peppercorn", "garlic"] },
    ],
    [
        { name: "Ghormeh Sabzi", tags: ["persian", "main", "stew"], ingredients: ["lamb", "parsley", "fenugreek", "kidney bean", "dried lime", "rice"] },
        { name: "Ghormeh Sabzi", tags: ["iranian", "main", "stew"], ingredients: ["lamb shoulder", "herbs", "fenugreek", "red bean", "dried lime"] },
    ],
];

/**
 * The same measurement with EVERY other variable held fixed: identical name,
 * identical ingredients, one tag changed. Isolates the cost of the cuisine label
 * itself, which the pairs above confound with ingredient wording.
 *
 * This is the number that says how much headroom a cuisine-scoped identity has.
 * If swapping one tag costs 0.01 the label is nearly free signal and the split
 * is safe; if it costs 0.10 then the tag is doing a lot of work in the embedding
 * and same-dish pairs are closer to LOW than the drift fixtures suggest.
 */
const LABEL_ONLY_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Shakshuka", tags: ["middle eastern", "main"], ingredients: ["egg", "tomato", "bell pepper", "onion", "cumin", "paprika"] },
        { name: "Shakshuka", tags: ["north african", "main"], ingredients: ["egg", "tomato", "bell pepper", "onion", "cumin", "paprika"] },
    ],
    [
        { name: "Mapo Tofu", tags: ["chinese", "main"], ingredients: ["tofu", "ground pork", "doubanjiang", "sichuan peppercorn", "scallion"] },
        { name: "Mapo Tofu", tags: ["sichuan", "main"], ingredients: ["tofu", "ground pork", "doubanjiang", "sichuan peppercorn", "scallion"] },
    ],
    [
        { name: "Manti", tags: ["turkish", "main", "dumpling"], ingredients: ["ground beef", "flour", "yogurt", "garlic", "butter", "paprika", "mint"] },
        { name: "Manti", tags: ["kazakh", "main", "dumpling"], ingredients: ["ground beef", "flour", "yogurt", "garlic", "butter", "paprika", "mint"] },
    ],
];

async function score(a: DishFixture, b: DishFixture): Promise<number> {
    const [ea, eb] = await Promise.all([
        generateEmbedding(sig(a)),
        generateEmbedding(sig(b)),
    ]);
    return cosine(ea, eb);
}

async function main() {
    console.log("SAME-dish pairs (want high / auto-merge):");
    const same: number[] = [];
    for (const [a, b] of SAME_PAIRS) {
        const s = await score(a, b);
        same.push(s);
        console.log(`  ${s.toFixed(3)}  ${a.name} ↔ ${b.name}`);
    }

    console.log("\nDIFFERENT-dish pairs (want low / distinct):");
    const diff: number[] = [];
    for (const [a, b] of DIFFERENT_PAIRS) {
        const s = await score(a, b);
        diff.push(s);
        console.log(`  ${s.toFixed(3)}  ${a.name} ↔ ${b.name}`);
    }

    const minSame = Math.min(...same);
    const maxSame = Math.max(...same);
    const minDiff = Math.min(...diff);
    const maxDiff = Math.max(...diff);

    console.log("\n" + "=".repeat(46));
    console.log(`same-dish  : min ${minSame.toFixed(3)}  max ${maxSame.toFixed(3)}`);
    console.log(`diff-dish  : min ${minDiff.toFixed(3)}  max ${maxDiff.toFixed(3)}`);
    console.log(
        "\nGuidance: set HIGH just above maxDiff (auto-merge only what's clearly\n" +
            "same), LOW below minSame so real same-dish pairs at least reach the gray\n" +
            "band for the LLM. Overlap (maxDiff >= minSame) => the LLM must resolve it."
    );
    const suggestedHigh = Math.min(0.97, Math.max(maxDiff + 0.01, 0.9));
    const suggestedLow = Math.max(0.7, Math.min(minSame - 0.02, maxDiff - 0.03));
    console.log(
        `\nsuggested HIGH ≈ ${suggestedHigh.toFixed(2)}, LOW ≈ ${suggestedLow.toFixed(2)}`
    );

    await reportCuisineIdentity();
}

/** Where a score lands relative to the SHIPPED band. */
function band(score: number): string {
    if (score >= SIGNATURE_HIGH_THRESHOLD) return "auto-merge";
    if (score >= SIGNATURE_LOW_THRESHOLD) return "gray band";
    return "distinct  ";
}

/**
 * Section three. Scored against the shipped thresholds and reported as a
 * verdict — deliberately NOT folded into the arithmetic above. See the file
 * header for why a homograph must never move HIGH.
 */
async function reportCuisineIdentity(): Promise<void> {
    console.log("\n" + "=".repeat(46));
    console.log(
        `Cuisine as dish identity — scored against the SHIPPED band\n` +
            `(HIGH ${SIGNATURE_HIGH_THRESHOLD}, LOW ${SIGNATURE_LOW_THRESHOLD}). Does not feed the suggestion above.`
    );

    const run = async (
        title: string,
        pairs: Array<[DishFixture, DishFixture]>,
        label: (a: DishFixture, b: DishFixture) => string
    ): Promise<number[]> => {
        console.log(`\n${title}`);
        const scores: number[] = [];
        for (const [a, b] of pairs) {
            const s = await score(a, b);
            scores.push(s);
            console.log(`  ${s.toFixed(3)}  [${band(s)}]  ${label(a, b)}`);
        }
        return scores;
    };

    const cuisineOf = (d: DishFixture) => d.tags[0];

    const homograph = await run(
        "HOMOGRAPHS (one name, two dishes — want distinct):",
        HOMOGRAPH_PAIRS,
        (a, b) => `${a.name} [${cuisineOf(a)}] ↔ ${b.name} [${cuisineOf(b)}]`
    );
    const drift = await run(
        "CUISINE DRIFT (one dish, two labels — want merge):",
        CUISINE_DRIFT_PAIRS,
        (a, b) => `${a.name} [${cuisineOf(a)}] ↔ [${cuisineOf(b)}]`
    );
    const labelOnly = await run(
        "LABEL ONLY (cuisine tag is the sole difference):",
        LABEL_ONLY_PAIRS,
        (a, b) => `${a.name} [${cuisineOf(a)}] ↔ [${cuisineOf(b)}]`
    );

    const maxHomograph = Math.max(...homograph);
    const minDrift = Math.min(...drift);
    const minLabelOnly = Math.min(...labelOnly);

    console.log("\n" + "-".repeat(46));
    console.log(
        `homographs : max ${maxHomograph.toFixed(3)}  (want < HIGH ${SIGNATURE_HIGH_THRESHOLD})`
    );
    console.log(
        `drift      : min ${minDrift.toFixed(3)}  (want >= LOW ${SIGNATURE_LOW_THRESHOLD})`
    );
    console.log(
        `label only : min ${minLabelOnly.toFixed(3)}  — cost of the cuisine tag alone`
    );

    console.log("\nVERDICT");
    console.log(
        maxHomograph < SIGNATURE_HIGH_THRESHOLD
            ? `  read path: FALL-THROUGH. The calibrated band already separates every\n` +
                  `  homograph, so a name hit under an incompatible cuisine only has to stop\n` +
                  `  short-circuiting at step 0 and fall through to the signature layer. No\n` +
                  `  new adjudication call, no new prompt.`
            : `  read path: ADJUDICATE. A homograph scores ${maxHomograph.toFixed(3)}, at or above HIGH,\n` +
                  `  so the band would auto-merge it. The exact-name path needs an explicit\n` +
                  `  adjudicateSameDish (fail-OPEN — see the plan). Do NOT raise HIGH to fix\n` +
                  `  this: it is fitted to the distribution above.`
    );
    console.log(
        minDrift >= SIGNATURE_LOW_THRESHOLD
            ? `  ancestor rule: OPTIONAL. Every drift pair still reaches the gray band, so\n` +
                  `  the adjudicator gets a chance to merge them.`
            : `  ancestor rule: LOAD-BEARING. A drift pair scores ${minDrift.toFixed(3)}, below LOW, so the\n` +
                  `  band would silently SPLIT one dish into two rows. Ancestor-related\n` +
                  `  cuisines must merge before the band runs.`
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Calibration failed:", error);
        process.exit(1);
    });
