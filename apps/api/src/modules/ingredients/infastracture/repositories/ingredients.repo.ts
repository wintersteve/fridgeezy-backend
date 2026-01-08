import { supabase, TablesInsert } from "@/src/shared/supabase";
import { toPersistence } from "@/src/shared/toolkit";

const findByCanonicalId = async (input: string[]) => {
    return supabase.from("ingredients").select("id").in("canonical_id", input);
};

const upsert = async (input: TablesInsert<"ingredients">) => {
    const normalized = toPersistence<TablesInsert<"ingredients">>(input);

    return supabase
        .from("ingredients")
        .upsert(normalized, { onConflict: "name" })
        .select("id")
        .single();
};

export const IngredientsRepo = {
    findByCanonicalId,
    upsert,
};
