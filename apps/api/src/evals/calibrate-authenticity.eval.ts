import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { config } from "dotenv";

import { classifySuggestionAuthenticity } from "../modules/suggestions/services/verify-suggestion-authenticity";

config();

/**
 * Authenticity calibration. Prints the raw {status, confidence} the classifier
 * assigns across a spread of dishes so the CONFIDENCE_FLOOR (0.6) and the
 * attested-status rule (canonical + regional_variant pass) can be checked against
 * data — in particular whether legit modern dishes get dropped as modern_fusion.
 */
interface Fixture {
    dish: DishInput;
    expectPass: boolean;
}
interface DishInput {
    name: string;
    nameAlt: string;
    tags: string[];
    ingredients: string[];
}

const dto = (d: DishInput): GenerateSuggestionResponseDto => ({
    name: d.name,
    name_alt: d.nameAlt,
    description: "eval fixture",
    difficulty: "medium",
    ingredients: d.ingredients,
    tags: d.tags,
});

const FIXTURES: Fixture[] = [
    // Traditional canonical — expect PASS.
    { expectPass: true, dish: { name: "Spaghetti alla Carbonara", nameAlt: "Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"] } },
    { expectPass: true, dish: { name: "Murgh Makhani", nameAlt: "Butter Chicken", tags: ["indian", "main", "dish"], ingredients: ["chicken", "tomato", "butter", "cream"] } },
    { expectPass: true, dish: { name: "Pad Thai", nameAlt: "Pad Thai", tags: ["thai", "main", "dish"], ingredients: ["rice noodle", "shrimp", "tamarind", "peanut", "egg"] } },
    { expectPass: true, dish: { name: "Boeuf Bourguignon", nameAlt: "Beef Bourguignon", tags: ["french", "main", "dish"], ingredients: ["beef", "red wine", "carrot", "onion", "mushroom", "bacon"] } },
    // Regional variant — expect PASS.
    { expectPass: true, dish: { name: "Som Tam Lao", nameAlt: "Lao Green Papaya Salad", tags: ["lao", "salad", "dish"], ingredients: ["green papaya", "padaek", "field crab", "fish sauce", "lime"] } },
    // Modern but established — expect PASS (the tricky ones).
    { expectPass: true, dish: { name: "California Roll", nameAlt: "California Roll", tags: ["japanese", "appetizer", "dish"], ingredients: ["rice", "nori", "crab stick", "avocado", "cucumber"] } },
    { expectPass: true, dish: { name: "Buffalo Wings", nameAlt: "Buffalo Wings", tags: ["american", "appetizer", "dish"], ingredients: ["chicken wing", "hot sauce", "butter", "celery"] } },
    { expectPass: true, dish: { name: "Nachos", nameAlt: "Nachos", tags: ["mexican", "appetizer", "dish"], ingredients: ["tortilla chip", "cheese", "jalapeno", "bean"] } },
    // Inventions / hallucinations — expect DROP.
    { expectPass: false, dish: { name: "Carbonara with Asparagus", nameAlt: "Asparagus Carbonara", tags: ["italian", "main", "dish"], ingredients: ["spaghetti", "egg", "pecorino", "guanciale", "asparagus"] } },
    { expectPass: false, dish: { name: "Zorblatt Crunch", nameAlt: "Zorblatt Crunch", tags: ["fusion", "snack", "dish"], ingredients: ["moon dust", "glitter", "cardboard"] } },
];

async function main() {
    console.log("dish → status (confidence) → gate | expected\n");
    let unexpected = 0;
    for (const { dish, expectPass } of FIXTURES) {
        const { status, confidence } = await classifySuggestionAuthenticity(
            dto(dish)
        );
        const attested = status === "canonical" || status === "regional_variant";
        const pass = attested && confidence >= 0.6;
        const flag = pass === expectPass ? " " : "⚠";
        console.log(
            `${flag} ${dish.name.padEnd(26)} ${status.padEnd(16)} (${confidence.toFixed(2)}) → ${pass ? "PASS" : "DROP"} | want ${expectPass ? "PASS" : "DROP"}`
        );
        if (pass !== expectPass) unexpected++;
    }
    console.log(`\n${unexpected} unexpected verdict(s). Use the confidences above to sanity-check the 0.6 floor.`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Calibration failed:", error);
        process.exit(1);
    });
