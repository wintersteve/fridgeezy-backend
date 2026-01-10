import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

export type IngredientWithRelations = Tables<"ingredients"> & {
  categories: { name: string } | null;
  parent: { id: string; name: string } | null;
};

export const useIngredients = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["SUPABASE", "INGREDIENTS"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ingredients")
        .select("*, categories(name), parent:parent_id(id, name)")
        .order("name");

      return data as IngredientWithRelations[] | null;
    },
  });

  return { data, ...rest };
};
