import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { config } from "dotenv";

import { classifySuggestionAuthenticity } from "../modules/suggestions/services/verify-suggestion-authenticity";

config();

/**
 * Notability calibration. Prints the raw {status, confidence} the classifier
 * assigns across a spread of dishes so the CONFIDENCE_FLOOR (0.6) and the
 * attested-status rule (well_known + regional_variant pass) can be checked
 * against data.
 *
 * The axis this eval used to probe — "do legit modern dishes get dropped as
 * modern_fusion" — was answered yes, and `modern_fusion` is gone as a result.
 * What it watches now is the replacement: the floor has to sit high enough to
 * reject a nameless description and low enough to keep a dish that is famous
 * only inside its own culture. Those are the last two blocks below, and they are
 * the ones worth re-running after any edit to the prompt.
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

    // Well known but NOT globally famous, and not "traditional" in the narrow
    // sense — expect PASS. The old gate rated Chicken Tikka `modern_fusion` and
    // dropped it, which is the regression that moved this whole check onto the
    // notability axis. Each of these is ordered by name by the people who eat it.
    { expectPass: true, dish: { name: "Chicken Tikka", nameAlt: "Chicken Tikka", tags: ["indian", "appetizer", "dish"], ingredients: ["chicken", "yogurt", "garam masala", "ginger", "lemon"] } },
    { expectPass: true, dish: { name: "Korean Tacos", nameAlt: "Korean Tacos", tags: ["korean", "american", "main", "dish"], ingredients: ["tortilla", "bulgogi beef", "kimchi", "gochujang", "scallion"] } },
    { expectPass: true, dish: { name: "Tlayuda", nameAlt: "Oaxacan Pizza", tags: ["mexican", "main", "dish"], ingredients: ["tortilla", "black bean paste", "quesillo", "cabbage", "asiento"] } },

    // Nameless descriptions — expect DROP as `obscure`. This is the tail the
    // exclusion list drives the generator into once a cuisine fills up: each is
    // a plausible plate of food that nobody can order, because there is nothing
    // to order it BY.
    { expectPass: false, dish: { name: "Persian Chicken with Yogurt and Walnuts", nameAlt: "Persian Chicken with Yogurt and Walnuts", tags: ["persian", "main", "dish"], ingredients: ["chicken", "yogurt", "walnut", "saffron", "onion"] } },
    { expectPass: false, dish: { name: "Spiced Lentil Stew with Coconut", nameAlt: "Spiced Lentil Stew with Coconut", tags: ["indian", "main", "dish"], ingredients: ["lentil", "coconut milk", "cumin", "tomato", "spinach"] } },

    // The trap on the other side of that test: a real dish whose ENGLISH name is
    // a plain description. Must still PASS — "Green Papaya Salad" is Som Tam, and
    // dropping it as a description would gut the catalog of translated dishes.
    { expectPass: true, dish: { name: "Green Papaya Salad", nameAlt: "Som Tam", tags: ["thai", "salad", "dish"], ingredients: ["green papaya", "tomato", "long bean", "peanut", "fish sauce", "lime", "chili"] } },
];

async function main() {
    console.log("dish → status (confidence) → gate | expected\n");
    let unexpected = 0;
    for (const { dish, expectPass } of FIXTURES) {
        const { status, confidence } = await classifySuggestionAuthenticity(
            dto(dish)
        );
        const attested =
            status === "well_known" || status === "regional_variant";
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
