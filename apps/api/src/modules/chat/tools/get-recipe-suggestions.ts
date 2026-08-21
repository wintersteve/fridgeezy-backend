import { z } from "zod/v4";

import {
    COMPONENT_TAGS,
    searchRecipeSuggestions,
    type SearchRecipeSuggestionsOptions,
} from "../../recipes/services/search-recipe-suggestions";

/**
 * Optional per-call context threaded through the chat tool-execution path so
 * the tool can stream partial suggestions out as it generates them.
 */
export interface RecipeSuggestionToolContext {
    onPartialSuggestion?: SearchRecipeSuggestionsOptions["onPartialSuggestion"];
}

/**
 * Input schema for GET_RECIPE_SUGGESTIONS tool
 */
export const RecipeSuggestionInputSchema = z.object({
    query: z
        .string()
        .describe(
            "The search query - can be a recipe name, dish name, ingredient, sauce type, cuisine, or any food-related concept. Examples: 'steak sauce', 'pad thai', 'Italian pasta', 'vegan desserts'"
        ),
    dish: z
        .string()
        .optional()
        .describe(
            "The plain name of the specific dish the user asked for, set ONLY when they named an identifiable dish: 'a thai green curry recipe please' -> 'Thai Green Curry'; 'how do I make pad thai?' -> 'Pad Thai'. OMIT it when they described what they want instead of naming it — a category, cuisine, mood or ingredient question ('an apple dessert', 'something Italian', 'what can I make with chicken'). Setting it restricts existing-recipe matches to exactly that dish, so a similar-but-different dish (a red curry for a green curry request) cannot be returned in its place; on a vague request it would wrongly block every good answer."
        ),
    matchThreshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
            "Minimum similarity score for vector search (0-1). Omit to use the calibrated default — set it only to deliberately widen or narrow a search."
        ),
    maxResults: z
        .number()
        .int()
        .positive()
        .default(3)
        .optional()
        .describe("Maximum number of results to return"),
    ingredients: z
        .array(z.string())
        .optional()
        .describe(
            "The concrete ingredients the user says they have, one per entry, singular and unqualified (e.g. ['chicken', 'rice'] for 'what can I make with chicken and rice?'). Set this whenever the user asks what to cook FROM ingredients — it is the only way an existing recipe is matched by ingredient rather than by name. Omit it when they name a dish, a cuisine or a concept instead."
        ),
    component: z
        .enum(COMPONENT_TAGS)
        .optional()
        .describe(
            "Set this whenever the user asks for a COMPONENT rather than a finished dish: 'what sauce goes with apple strudel' is component 'sauce', 'a marinade for chicken' is 'marinade'. Results are then restricted to recipes of that component type and anything generated is forced to be one, so the dish being accompanied cannot come back as the answer. Omit it for ordinary dish requests."
        ),
    exclude: z
        .array(z.string())
        .optional()
        .describe(
            "Dish names that must NOT be returned: every dish already shown earlier in THIS conversation, plus the dish the user wants an accompaniment FOR ('what sauce goes with apple strudel' -> ['apple strudel']). Without it the search matches the accompanied dish and hands back the same card."
        ),
    difficulty: z
        .enum(["easy", "medium", "hard"])
        .optional()
        .describe(
            "How much SKILL the dish should ask of the cook. The scale starts at the real dish and climbs: 'easy' is the standard version cooked properly, 'medium' is a chef-level interpretation, 'hard' is what a Michelin-starred kitchen would send out. Set it ONLY when the user signals SKILL: 'nothing fancy', 'the usual way', 'straightforward' -> 'easy'; 'a bit special', 'impress someone', 'restaurant-level' -> 'medium'; 'go all out', 'a project', 'showstopper', 'Michelin' -> 'hard'. 'Something quick', 'weeknight' and 'no time' are about TIME, not skill — they must NOT set this field. OMIT it whenever they say nothing about skill: the user's own saved level is then applied, and setting this on a hunch overrides their preference."
        ),
    dietaryRestrictions: z
        .array(z.string())
        .optional()
        .describe(
            "Dietary tags every generated suggestion must satisfy (e.g. 'vegan', 'gluten_free')"
        ),
    blacklist: z
        .array(z.string())
        .optional()
        .describe(
            "Ingredients to never suggest (allergies/dislikes); recipes normally containing them are excluded"
        ),
});

/**
 * Output schema for GET_RECIPE_SUGGESTIONS tool
 */
export const RecipeSuggestionOutputSchema = z.object({
    suggestions: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            difficulty: z.enum(["easy", "medium", "hard"]),
            /**
             * Total minutes. Declared so the assistant can answer "how long
             * does this take" from the row rather than guessing a number that
             * would then disagree with the pill on the card beside its own
             * reply.
             */
            totalTimeMinutes: z.number().int().positive().nullable().optional(),
            source: z.enum(["existing_recipe", "suggestion", "new_suggestion"]),
            matchScore: z.number().optional(),
            ingredients: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                })
            ),
            tags: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                })
            ),
        })
    ),
    searchMetadata: z.object({
        vectorSearchHits: z.number(),
        canonicalSearchHits: z.number(),
        newSuggestionsCreated: z.number(),
    }),
});

export type RecipeSuggestionInput = z.infer<typeof RecipeSuggestionInputSchema>;

/**
 * Tool handler for getting recipe suggestions.
 * Returns the tool-call content array the chat pipeline expects.
 */
export async function getRecipeSuggestionsHandler(
    input: RecipeSuggestionInput,
    context: RecipeSuggestionToolContext = {}
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const result = await searchRecipeSuggestions(input, {
        onPartialSuggestion: context.onPartialSuggestion,
    });

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}

/**
 * Tool definition for GET_RECIPE_SUGGESTIONS
 */
export const getRecipeSuggestionsTool = {
    name: "GET_RECIPE_SUGGESTIONS",
    definition: {
        title: "Get Recipe Suggestions",
        description:
            "Search for and get recipe suggestions based on any query about food, recipes, ingredients, dishes, or cooking. This tool searches existing recipes first, then generates new authentic recipe suggestions if nothing is found. Use this whenever the user asks about recipes, dishes, sauces, ingredients, cooking methods, or food recommendations. Returns detailed recipes with ingredients, tags, difficulty levels, and descriptions.",
        inputSchema: RecipeSuggestionInputSchema,
        outputSchema: RecipeSuggestionOutputSchema,
    },
    handler: getRecipeSuggestionsHandler,
};
