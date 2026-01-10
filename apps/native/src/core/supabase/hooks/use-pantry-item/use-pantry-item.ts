import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export interface PantryItemWithIngredient extends Tables<"pantry_items"> {
  ingredient: Tables<"ingredients">;
}

export interface UsePantryItemsOptions {
  id?: string | null;
}

export const usePantryItem = (options: UsePantryItemsOptions) => {
  const { id } = options;

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("pantry_items")
        .select("*, ingredient:ingredient_id(*)")
        .eq("ingredient_id", id!)
        .single();

      return (data as PantryItemWithIngredient) ?? null;
    },
    queryKey: ["supabase", "pantry_items", id],
    enabled: !!id,
  });
};
