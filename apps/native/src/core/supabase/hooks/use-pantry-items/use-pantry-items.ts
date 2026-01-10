import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type PantryItemWithIngredient = Tables<"pantry_items"> & {
  ingredient: { id: string; name: string } | null;
};

export const usePantryItems = () => {
  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("pantry_items")
        .select("*, ingredient:ingredient_id(id, name)");

      return (data as PantryItemWithIngredient[] | null) ?? [];
    },
    queryKey: ["supabase", "pantry_items"],
  });
};
