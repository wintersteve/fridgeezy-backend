import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
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
    nameAlt: string;
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

    console.log("\nAuthenticity — should PASS:");
    for (const d of AUTHENTIC_DISHES) {
        check(d.name, (await verifySuggestionAuthenticity(toDto(d))).authentic, true);
    }

    console.log("\nAuthenticity — should be DROPPED:");
    for (const d of INVENTION_DISHES) {
        check(d.name, (await verifySuggestionAuthenticity(toDto(d))).authentic, false);
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
