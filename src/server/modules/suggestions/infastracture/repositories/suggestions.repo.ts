import { supabase, TablesInsert } from "@/src/shared/supabase";
import { fromPersistence, toPersistence } from "@/src/shared/toolkit";

const insert = async (input: TablesInsert<"recipe_suggestions">) => {
    const { name, description, difficulty } =
        toPersistence<TablesInsert<"recipe_suggestions">>(input);

    const { data, ...rest } = await supabase
        .from("recipe_suggestions")
        .insert({
            name,
            description,
            difficulty,
        })
        .select("*")
        .single();

    return {
        data: fromPersistence<TablesInsert<"recipe_suggestions">>(data),
        ...rest,
    };
};

const getById = async (id: string) => {
    const { data, ...rest } = await supabase
        .from("recipe_suggestions")
        .select("*")
        .eq("id", id)
        .single();

    return { data: fromPersistence(data), ...rest };
};

const getByName = async (name: string) => {
    const { data, ...rest } = await supabase
        .from("recipe_suggestions")
        .select("*")
        .eq("name", name)
        .single();

    return { data: fromPersistence(data), ...rest };
};

export const SuggestionsRepo = { insert, getById, getByName };
