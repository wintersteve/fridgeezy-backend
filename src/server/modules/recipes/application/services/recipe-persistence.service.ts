import {
    CategoriesRepo,
    IngredientsRepo,
} from "@/src/server/modules/ingredients";
import { RecipeAccumulator } from "@/src/server/modules/recipes/domain";

import { RecipeIngredientsRepo, RecipesRepo } from "../../infastracture";

/**
 * Resolves a category name to its ID.
 * Logs an error if the category is not found.
 */
const resolveCategoryId = async (
    categoryName: string
): Promise<string | null> => {
    const categoryId = await CategoriesRepo.getIdByName(categoryName);
    if (!categoryId) {
        console.error(`Invalid category: ${categoryName}`);
    }
    return categoryId;
};

/**
 * Resolves a parent ingredient by name, using cache to avoid duplicate lookups.
 * Creates the parent ingredient if it doesn't exist.
 */
const resolveParentIngredient = async (
    parentName: string,
    categoryId: string,
    cache: Record<string, string>
): Promise<string | null> => {
    if (cache[parentName]) {
        return cache[parentName];
    }

    const parentResponse = await IngredientsRepo.upsert({
        name: parentName,
        category_id: categoryId,
    });

    if (parentResponse.data?.id) {
        cache[parentName] = parentResponse.data.id;
        return parentResponse.data.id;
    }

    return null;
};

/**
 * Persists a generated recipe with all its ingredients and relationships.
 * Handles category resolution, parent ingredients, and recipe-ingredient associations.
 */
export const persistGenerateRecipe = async (input: RecipeAccumulator) => {
    const recipeResponse = await RecipesRepo.insert({
        ...input,
        instructions: input.instructions.map((instruction) => instruction.text),
    });

    const parentIdCache: Record<string, string> = {};

    for (const ingredient of input.ingredients) {
        const categoryId = await resolveCategoryId(ingredient.category);
        if (!categoryId) continue;

        let parentId: string | null = null;
        if (ingredient.parent) {
            parentId = await resolveParentIngredient(
                ingredient.parent,
                categoryId,
                parentIdCache
            );
        }

        const ingredientResponse = await IngredientsRepo.upsert({
            name: ingredient.name,
            category_id: categoryId,
            parent_id: parentId,
        });

        if (ingredientResponse.data?.id && recipeResponse.data?.id) {
            await RecipeIngredientsRepo.upsert({
                ingredientId: ingredientResponse.data.id,
                recipeId: recipeResponse.data.id,
                quantity: ingredient.quantity,
                unitId: ingredient.unit,
            });
        }
    }
};
