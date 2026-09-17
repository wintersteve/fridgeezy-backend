import { fetchRecipe } from "./fetch-recipe";
import { callerMayReadRecipe } from "./recipe-access";

/**
 * The dish a request is ABOUT, or the reason there is no answer about it.
 *
 * Owned recipes are readable only by their owner, and these reads run as the
 * service role, past the RLS that enforces that elsewhere. Answered as the same
 * 404 a missing recipe gets, so the two are indistinguishable to a caller
 * probing ids — the rule `composeRecipe` follows.
 *
 * Extracted from `dish-pairings.ts` when `menuTitle` became a second route
 * keyed on a recipe the caller must be entitled to read. Two copies of an
 * access check is two places for one of them to be relaxed by accident, and the
 * relaxation would not show up as anything: the wrong answer here is a private
 * recipe's name reaching somebody who guessed its id.
 *
 * **Pairings do NOT use this any more — see `loadSeedDish`.** What is left here
 * is `menuTitle`, which names a menu already composed around a written recipe
 * and so genuinely has one. Reach for this only when the METHOD matters; a
 * question about the dish takes the other.
 */
export const loadSeedRecipe = async (recipeId: string | undefined, req: unknown) => {
    if (!recipeId) {
        return { error: { status: 400, body: { error: "Recipe ID is required" } } };
    }

    const recipe = await fetchRecipe(recipeId);

    if (
        !recipe ||
        !(await callerMayReadRecipe(
            recipe.createdBy,
            req as Parameters<typeof callerMayReadRecipe>[1]
        ))
    ) {
        return {
            error: {
                status: 404,
                body: { error: "Recipe not found", recipeId },
            },
        };
    }

    return { recipe };
};
