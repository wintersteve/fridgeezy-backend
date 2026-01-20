import { supabaseAdmin } from "@fridgeezy/supabase";

export interface RecipeSummary {
    id: string;
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    ingredients: Array<{ id: string; name: string }>;
    tags: Array<{ id: string; name: string }>;
}

/**
 * Fetch a recipe summary with ingredient and tag IDs and names.
 * Lighter than fetchRecipe - only gets basic info needed for compose results.
 *
 * @param recipeId - The recipe UUID
 * @returns Recipe summary or null if not found
 */
export async function fetchRecipeSummary(
    recipeId: string
): Promise<RecipeSummary | null> {
    const { data: recipe, error } = await supabaseAdmin
        .from("recipes")
        .select(
            `
            id,
            name,
            description,
            difficulty,
            recipe_ingredients (
                ingredient:ingredients (
                    id,
                    name
                )
            ),
            recipe_tags (
                tag:tags (
                    id,
                    name
                )
            )
        `
        )
        .eq("id", recipeId)
        .single();

    if (error || !recipe) {
        return null;
    }

    return {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description || "",
        difficulty: recipe.difficulty as "easy" | "medium" | "hard",
        ingredients: recipe.recipe_ingredients.map((ri) => ({
            id: ri.ingredient.id,
            name: ri.ingredient.name,
        })),
        tags: recipe.recipe_tags.map((rt) => ({
            id: rt.tag.id,
            name: rt.tag.name,
        })),
    };
}
