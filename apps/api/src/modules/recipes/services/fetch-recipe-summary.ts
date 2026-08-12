import { supabaseAdmin } from "@fridgeezy/supabase";

export interface RecipeSummary {
    id: string;
    name: string;
    nameEn?: string | null;
    description: string;
    /**
     * The one-line card form. Card callers must prefer this over `description`,
     * which is the detail-screen paragraph and truncates mid-sentence on a card.
     */
    shortDescription?: string | null;
    /**
     * Hero image. Without it a chat suggestion card falls back to its "NEW"
     * panel, which makes a recipe the catalogue already has look identical to a
     * dish that was just invented.
     */
    image?: string | null;
    difficulty: "easy" | "medium" | "hard";
    /**
     * Total minutes, for the time pill beside the difficulty one. Derived by
     * `persist_recipe` from this recipe's own prep and cook times, so it cannot
     * disagree with the detail screen.
     *
     * Nullable: a row written before `20260812000004` has none, and the client
     * draws no pill rather than guessing a band.
     */
    totalTimeMinutes?: number | null;
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
            name_en,
            description,
            short_description,
            image,
            difficulty,
            total_time_minutes,
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
        nameEn: recipe.name_en ?? null,
        description: recipe.description || "",
        shortDescription: recipe.short_description ?? null,
        image: recipe.image ?? null,
        difficulty: recipe.difficulty as "easy" | "medium" | "hard",
        totalTimeMinutes: recipe.total_time_minutes ?? null,
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
