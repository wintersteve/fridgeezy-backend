import { supabase, TablesInsert } from "@/src/shared/supabase";
import { toPersistence } from "@/src/shared/toolkit";

const upsert = async (input: TablesInsert<"ingredients">) => {
    const normalized = toPersistence<TablesInsert<"ingredients">>(input);

    return supabase
        .from("ingredients")
        .upsert(normalized, { onConflict: "name" })
        .select("id")
        .single();
};

export const IngredientsRepo = {
    upsert,
};
