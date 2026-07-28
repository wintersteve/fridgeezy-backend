import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { config } from "dotenv";

import { adjudicateSameDish } from "../modules/suggestions/services/adjudicate-suggestion";
import { describeSuggestion } from "../modules/suggestions/services/suggestion-signature";
import { verifySuggestionAuthenticity } from "../modules/suggestions/services/verify-suggestion-authenticity";

config();

/**
 * Eval harness (RECIPE_QUALITY_PLAN.md, Phase 5). Exercises the two LLM decision
 * points that Phase 3/4 rely on — the dish-dedup adjudicator and the authenticity
 * gate — against the plan's acceptance fixtures. Hits OpenAI, so results can vary
 * run to run; treat a failure as a signal to re-check prompts/thresholds. Exits
 * non-zero if any fixture fails.
 */
interface DishFixture {
    name: string;
    nameEn: string;
    tags: string[];
    ingredients: string[];
}

const descriptor = (d: DishFixture): string =>
    describeSuggestion(d.name, d.nameEn, d.tags, d.ingredients);

const toDto = (d: DishFixture): GenerateSuggestionResponseDto => ({
    name: d.name,
    name_en: d.nameEn,
    description: "eval fixture",
    difficulty: "medium",
    ingredients: d.ingredients,
    tags: d.tags,
});

// Same dish under different names / languages — should MERGE (adjudicate same).
const SAME_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam", nameEn: "Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut", "tomato"] },
        { name: "Papaya Salad", nameEn: "Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "fish sauce", "lime", "chili", "peanut"] },
    ],
    [
        { name: "Murgh Makhani", nameEn: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream", "garam masala"] },
        { name: "Butter Chicken", nameEn: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] },
    ],
];

// Genuine variations / distinct dishes — should STAY DISTINCT (adjudicate not-same).
const DISTINCT_PAIRS: Array<[DishFixture, DishFixture]> = [
    [
        { name: "Som Tam Thai", nameEn: "Thai Green Papaya Salad", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "peanut", "dried shrimp", "tomato", "fish sauce", "lime"] },
        { name: "Som Tam Lao", nameEn: "Lao Green Papaya Salad", tags: ["lao", "salad", "dish"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime", "eggplant"] },
    ],
    [
        { name: "Roux", nameEn: "Roux", tags: ["french", "roux", "component"], ingredients: ["flour", "butter"] },
        { name: "Béchamel", nameEn: "Bechamel Sauce", tags: ["french", "sauce", "component"], ingredients: ["flour", "butter", "milk"] },
    ],
];

// Attested dishes — should PASS the authenticity gate.
const AUTHENTIC_DISHES: DishFixture[] = [
    { name: "Spaghetti alla Carbonara", nameEn: "Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] },
    { name: "Murgh Makhani", nameEn: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] },
];

// Inventions / hallucinations — should be DROPPED by the authenticity gate.
const INVENTION_DISHES: DishFixture[] = [
    { name: "Carbonara with Asparagus", nameEn: "Asparagus Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "asparagus"] },
    { name: "Zorblatt Crunch", nameEn: "Zorblatt Crunch", tags: ["fusion", "snack", "dish"], ingredients: ["moon dust", "glitter", "cardboard"] },
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
        check(d.name, await verifySuggestionAuthenticity(toDto(d)), true);
    }

    console.log("\nAuthenticity — should be DROPPED:");
    for (const d of INVENTION_DISHES) {
        check(d.name, await verifySuggestionAuthenticity(toDto(d)), false);
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
