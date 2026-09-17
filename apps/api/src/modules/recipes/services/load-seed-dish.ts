import { fetchEnrichedSuggestion } from "../../suggestions/services";

import { fetchRecipe } from "./fetch-recipe";
import { callerMayReadRecipe } from "./recipe-access";

/**
 * The dish a pairing request is ABOUT, in the only shape the pairing prompt
 * reads.
 *
 * Five fields, and that is the whole point of the type: `generateDishPairings`
 * was typed against `GenerateRecipeResponseDto` because a written recipe was
 * the only thing that could seed it, and it never touched a single field a
 * recipe has and an idea does not — no steps, no servings, no times. Narrowing
 * the parameter to what is actually read is what lets an unwritten dish answer
 * the same question.
 */
export interface PairingSeed {
    id: string;
    name: string;
    description: string;
    difficulty: string;
    ingredients: { name: string }[];
    /** Tag NAMES. A recipe carries these as strings; a suggestion as rows. */
    tags: string[];
}

/**
 * A recipe OR a suggestion, whichever the id names — or the reason there is no
 * answer about it.
 *
 * ## Why an idea may seed a pairing set
 *
 * "What goes with a bouillabaisse" is a question about a DISH, and every input
 * the model is given to answer it — the name, the gloss, the first eight
 * ingredients, the difficulty and the cuisine tags — exists on a suggestion the
 * moment it is written. Nothing in the prompt has ever needed the method.
 *
 * Requiring a recipe therefore bought nothing and cost the chat's menu card its
 * whole flow: most menus come back with a main that has not been written, so
 * asking what to serve alongside one meant promoting it first — a full recipe
 * generation triggered by a press on the word "Dessert".
 *
 * ## The cached set survives the promotion, and that is not luck
 *
 * `resolveDishKey` keys a set on `source_suggestion_id ?? id`, so a set stored
 * against suggestion S is the set a recipe promoted FROM S reads back. Pairings
 * found for an idea are therefore already paid for when the idea becomes a
 * dish — the same rows, under the same key, with nothing to migrate. That
 * lookup needs no change either: it queries `recipes`, misses for a suggestion
 * id, and falls through to returning the id it was given.
 *
 * ## Access
 *
 * A recipe may be owned, so it keeps `callerMayReadRecipe` and the 404 that
 * makes a private recipe indistinguishable from a missing one. `recipe_suggestions`
 * is the shared catalogue with no owner column — there is nothing to check and
 * nothing to leak.
 *
 * The recipe is tried FIRST, which matters for more than ordering: the two id
 * spaces are distinct uuids, so a hit in `recipes` is definitive, and only a
 * miss is worth a second round trip. An ordinary recipe pairing therefore costs
 * exactly what it did before this existed.
 */
export const loadSeedDish = async (dishId: string | undefined, req: unknown) => {
    if (!dishId) {
        return { error: { status: 400, body: { error: "Dish ID is required" } } };
    }

    const recipe = await fetchRecipe(dishId);

    if (recipe) {
        const mayRead = await callerMayReadRecipe(
            recipe.createdBy,
            req as Parameters<typeof callerMayReadRecipe>[1]
        );

        if (!mayRead) {
            return {
                error: {
                    status: 404,
                    body: { error: "Recipe not found", recipeId: dishId },
                },
            };
        }

        return {
            seed: {
                id: recipe.id,
                name: recipe.name,
                description: recipe.description,
                difficulty: recipe.difficulty,
                ingredients: recipe.ingredients,
                tags: recipe.tags,
            },
        };
    }

    const suggestion = await fetchEnrichedSuggestion(dishId);

    if (!suggestion.success) {
        return {
            error: {
                status: 404,
                body: { error: "Dish not found", recipeId: dishId },
            },
        };
    }

    return {
        seed: {
            id: suggestion.value.id,
            name: suggestion.value.name,
            description: suggestion.value.description,
            difficulty: suggestion.value.difficulty,
            ingredients: suggestion.value.ingredients,
            // Names, because that is what a recipe hands over and what
            // `matchCuisines` compares against. A suggestion stores tag ROWS.
            tags: suggestion.value.tags.map((tag) => tag.name),
        },
    };
};
