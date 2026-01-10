import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";

export const usePopularRecipes = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["SUPABASE", "RECIPES", "POPULAR"],
    queryFn: async () => {
      const { data } = await supabase.from("recipes").select("*");

      return data;
    },
  });

  return { data, ...rest };
};
