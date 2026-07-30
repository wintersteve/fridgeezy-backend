import { GenerateSuggestionRequestDto } from "@fridgeezy/schemas";

/**
 * The fixed input set. Phase 0 calls for a set that is *fixed* — the whole point
 * is that the same inputs run against every candidate, so a score delta is
 * attributable to the model rather than to the sample.
 *
 * Coverage is chosen to exercise the ways the suggestion prompt can go wrong,
 * not to be representative of traffic:
 *  - a dish name (must return authentic variations, never invent)
 *  - literal ingredients (must pick real dishes featuring them)
 *  - a meal/course concept (must never return an empty array)
 *  - a blacklist (must actually exclude)
 *  - a cuisine + dietary restriction (the tightest tagging constraint)
 */
export interface SuggestionFixture {
    label: string;
    request: GenerateSuggestionRequestDto;
    /**
     * Ingredients that must appear across the returned set for the result to be
     * culinarily honest. Only set where the request names a specific dish —
     * otherwise the model legitimately has free choice and this cannot be scored.
     */
    requiredIngredients?: string[];
    /** Ingredients that must NOT appear anywhere (blacklist enforcement). */
    forbiddenIngredients?: string[];
}

export const SUGGESTION_FIXTURES: SuggestionFixture[] = [
    {
        label: "dish name — carbonara",
        request: { ingredients: ["carbonara"] } as GenerateSuggestionRequestDto,
        // The dish is defined by these; a "carbonara" without egg or a cured pork
        // is the exact authenticity failure the prompt's rules target.
        requiredIngredients: ["egg"],
    },
    {
        label: "literal ingredients — chicken + tomato + cream",
        request: {
            ingredients: ["chicken", "tomato", "cream"],
        } as GenerateSuggestionRequestDto,
    },
    {
        label: "meal concept — quick dinner (must not return empty)",
        request: { ingredients: ["quick dinner"] } as GenerateSuggestionRequestDto,
    },
    {
        label: "cuisine + dietary — thai, vegan",
        request: {
            cuisine: "thai",
            dietaryRestrictions: ["vegan"],
            ingredients: ["rice noodle"],
        } as GenerateSuggestionRequestDto,
    },
    {
        label: "blacklist — pasta without tomato",
        request: {
            ingredients: ["pasta"],
            blacklist: ["tomato"],
        } as GenerateSuggestionRequestDto,
        forbiddenIngredients: ["tomato"],
    },
];

/**
 * Recipe-path fixtures. The recipe prompt is built from a *persisted* suggestion
 * in production; here the suggestion is synthetic so the harness stays
 * independent of database contents, while the prompt itself is still the real
 * one (see `buildRecipeSystemPrompt`).
 */
export interface RecipeFixture {
    label: string;
    name: string;
    difficulty: "easy" | "medium" | "hard";
    ingredientNames: string[];
    servings: number;
}

export const RECIPE_FIXTURES: RecipeFixture[] = [
    {
        label: "carbonara / medium",
        name: "Spaghetti alla Carbonara",
        difficulty: "medium",
        ingredientNames: ["spaghetti", "egg", "pecorino", "guanciale", "black pepper"],
        servings: 4,
    },
    {
        label: "butter chicken / easy",
        name: "Murgh Makhani",
        difficulty: "easy",
        ingredientNames: ["chicken", "tomato", "butter", "cream", "garam masala"],
        servings: 4,
    },
    {
        // Short ingredient list + a component (not a finished dish) — stresses the
        // "EXACTLY 1 component tag" rule, where `dish` is the wrong answer.
        label: "bechamel / easy (component, not dish)",
        name: "Béchamel",
        difficulty: "easy",
        ingredientNames: ["flour", "butter", "milk"],
        servings: 4,
    },
];
