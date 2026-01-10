import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

export interface RecipeData extends Tables<"recipes"> {
  ingredients: Tables<"recipe_ingredients">;
}

export const useRecipes = (ids: string[]) => {
  return useQuery({
    queryKey: ["supabase", "recipes", [...ids].sort()],
    queryFn: async () => {
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from("recipes")
        .select(
          "*, ingredients:recipe_ingredients(*, ingredient:ingredients(id, name), unit:units(id, abbreviation))",
        )
        .in("id", ids);

      if (error) throw error;
      return data ?? [];
    },
    enabled: ids.length > 0,
  });
};
