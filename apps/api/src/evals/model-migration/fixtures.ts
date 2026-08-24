import {
    GenerateSuggestionRequestDto,
    SuggestSubstitutesRequestDto,
} from "@fridgeezy/schemas";

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
        // Short ingredient list + a component (not a finished dish) — stresses
        // the component rule from the side that is now the RARE one. Since the
        // rule inverted to absent-by-default, the failure to catch here is a
        // genuine sauce coming back with no component tag at all; the old
        // failure ("dish" on a béchamel) is no longer expressible.
        label: "bechamel / easy (component, not dish)",
        name: "Béchamel",
        difficulty: "easy",
        ingredientNames: ["flour", "butter", "milk"],
        servings: 4,
    },
];

/**
 * Substitutes fixtures.
 *
 * `recipeId` is never looked up here — the eval passes `null` for the recipe, so
 * the prompt falls back to `recipeName` and the harness stays free of any
 * database dependency. What is being measured is the model's obedience to the
 * output contract, not the enrichment.
 *
 * Coverage targets the ways that contract breaks:
 *  - several missing ingredients at once (one line each, in request order)
 *  - a name the model will want to normalise (it must echo it EXACTLY)
 *  - a cuisine-sensitive swap, where the generic answer is the wrong one
 *  - an ingredient that is genuinely optional ("Leave it out" is legitimate)
 *  - a caller whose restrictions rule out the obvious swap
 */
export interface SubstituteFixture {
    label: string;
    request: SuggestSubstitutesRequestDto;
}

const missing = (...names: string[]) =>
    names.map((name, index) => ({ id: `fixture-${index}`, name }));

export const SUBSTITUTE_FIXTURES: SubstituteFixture[] = [
    {
        // Three at once: the prompt demands one line per ingredient in request
        // order, and this is where a model starts merging or dropping them.
        label: "carbonara — three missing at once",
        request: {
            recipeId: "fixture-carbonara",
            recipeName: "Spaghetti alla Carbonara",
            missingIngredients: missing("guanciale", "pecorino romano", "egg yolk"),
        },
    },
    {
        // "Nam pla" is the kind of name a model helpfully rewrites to "fish
        // sauce". The contract says echo it EXACTLY, because the client keys its
        // cards on the requested name and a rewrite orphans the card.
        label: "thai — exact-name echo",
        request: {
            recipeId: "fixture-padthai",
            recipeName: "Pad Thai",
            missingIngredients: missing("nam pla", "tamarind paste"),
        },
    },
    {
        // Cuisine-sensitivity: butter in a French pan sauce wants a different
        // answer than butter in pastry, which is the rule the prompt leads with.
        label: "french — cuisine-sensitive swap",
        request: {
            recipeId: "fixture-beurreblanc",
            recipeName: "Beurre Blanc",
            missingIngredients: missing("shallot", "dry white wine"),
        },
    },
    {
        // Garnish: "Leave it out" is an allowed first answer here, and the model
        // must still emit a line rather than refusing the ingredient.
        label: "garnish — legitimately omittable",
        request: {
            recipeId: "fixture-pho",
            recipeName: "Pho Bo",
            missingIngredients: missing("thai basil"),
        },
    },
    {
        // Restrictions, on the two ingredients whose obvious answer they take
        // away: butter's is cream or ghee, and heavy cream's is more dairy. The
        // model has to reach past the first thing it thinks of rather than
        // refusing the line — a dropped line reads to the client as a card that
        // never arrives.
        //
        // `compileBlacklist` catches an exact "double cream" in the output; it
        // cannot catch "ghee", which is a form of butter under a different
        // canonical id. That gap is the model's half of the rule, so this is
        // the fixture that measures it.
        label: "restricted — obvious swap ruled out",
        request: {
            recipeId: "fixture-gratin",
            recipeName: "Potato Gratin",
            missingIngredients: missing("butter", "heavy cream"),
            blacklist: ["double cream"],
            dietaryRestrictions: ["dairy_free"],
        },
    },
];
