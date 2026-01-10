import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

export type RecipeData = Tables<"recipes">;

export const useRecipe = (id: string) => {
  const { data, ...rest } = useQuery({
    queryKey: ["SUPABASE", "RECIPES", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select(
          "*, ingredients:recipe_ingredients(*, ingredient:ingredients(id, name), unit:units(id, abbreviation))",
        )
        .eq("id", id)
        .single();

      return data as RecipeData;
    },
  });

  return { data, ...rest };
};
