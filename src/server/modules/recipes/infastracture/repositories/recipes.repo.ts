import { supabase, TablesInsert } from "@/src/shared/supabase";
import { fromPersistence, toPersistence } from "@/src/shared/toolkit";

const insert = async (input: TablesInsert<"recipes">) => {
    const {
        name,
        description,
        difficulty,
        servings,
        prep_time,
        cook_time,
        tips,
        instructions,
    } = toPersistence<TablesInsert<"recipes">>(input);

    const { data, ...rest } = await supabase
        .from("recipes")
        .insert({
            name,
            description,
            difficulty,
            servings,
            prep_time,
            cook_time,
            tips,
            instructions,
        })
        .select("*")
        .single();

    return { data: fromPersistence<TablesInsert<"recipes">>(data), ...rest };
};

const getById = async (id: string) => {
    const { data, ...rest } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .single();

    return { data: fromPersistence(data), ...rest };
};

export const RecipesRepo = { insert, getById };
