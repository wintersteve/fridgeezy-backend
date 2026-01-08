import { ObjectToCamel, objectToSnake } from "ts-case-convert";

import { supabase, TablesInsert } from "@/src/shared/supabase";

const upsert = async (
    input: ObjectToCamel<TablesInsert<"recipe_ingredients">>
) => {
    const normalized = objectToSnake(input);

    return supabase.from("recipe_ingredients").insert(normalized);
};

const getByRecipeId = async (recipeId: string) => {
    const { data, ...rest } = await supabase
        .from("recipe_ingredients")
        .select(
            `
            id,
            quantity,
            ingredient_id,
            unit_id,
            ingredients (
                id,
                name,
                category_id,
                parent_id,
                categories (
                    name
                )
            ),
            units (
                id,
                name,
                abbreviation
            )
        `
        )
        .eq("recipe_id", recipeId);

    return { data, ...rest };
};

export const RecipeIngredientsRepo = {
    upsert,
    getByRecipeId,
};
