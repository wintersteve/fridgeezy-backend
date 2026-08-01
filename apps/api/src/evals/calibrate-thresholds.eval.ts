import { generateEmbedding } from "@fridgeezy/openai";
import { buildSuggestionSignature } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Threshold calibration (RECIPE_QUALITY_PLAN.md, Phase 5 tuning). Measures the
 * actual signature-embedding cosine similarity for known same-dish and
 * different-dish pairs, so SIGNATURE_HIGH_THRESHOLD / SIGNATURE_LOW_THRESHOLD in
 * persist-or-reuse-suggestion can be set from real score distributions instead of
 * guessed. Prints both distributions and a suggested band.
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
        { name: "Som Tam", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut", "tomato"] },
        { name: "Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut"] },
    ],
    [
        { name: "Murgh Makhani", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] },
        { name: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] },
    ],
    [
        { name: "Phở Bò", tags: ["vietnamese", "soup", "dish"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "scallion", "cilantro"] },
        { name: "Pho", tags: ["vietnamese", "soup", "dish"], ingredients: ["rice noodle", "beef", "star anise", "ginger", "herbs"] },
    ],
    [
        { name: "Gyōza", tags: ["japanese", "appetizer", "dish"], ingredients: ["pork", "cabbage", "garlic", "ginger", "dumpling wrapper"] },
        { name: "Japanese Dumplings", tags: ["japanese", "appetizer", "dish"], ingredients: ["ground pork", "napa cabbage", "garlic", "ginger", "wrapper"] },
    ],
];

// Distinct dishes (incl. hard near-miss pairs) — SHOULD stay below the merge band.
const DIFFERENT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam Thai", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] },
        { name: "Som Tam Lao", tags: ["lao", "salad", "dish"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime", "eggplant"] },
    ],
    [
        { name: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream", "fenugreek"] },
        { name: "Chicken Tikka Masala", tags: ["indian", "main", "dish"], ingredients: ["chicken", "yogurt", "tomato", "cream", "garam masala", "onion"] },
    ],
    [
        { name: "Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
        { name: "Cacio e Pepe", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "pecorino", "black pepper"] },
    ],
    [
        { name: "Pad Thai", tags: ["thai", "main", "dish"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg", "bean sprout"] },
        { name: "Pad See Ew", tags: ["thai", "main", "dish"], ingredients: ["wide rice noodle", "chicken", "soy sauce", "egg", "chinese broccoli"] },
    ],
    [
        { name: "Roux", tags: ["french", "roux", "component"], ingredients: ["flour", "butter"] },
        { name: "Béchamel", tags: ["french", "sauce", "component"], ingredients: ["flour", "butter", "milk"] },
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
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Calibration failed:", error);
        process.exit(1);
    });
