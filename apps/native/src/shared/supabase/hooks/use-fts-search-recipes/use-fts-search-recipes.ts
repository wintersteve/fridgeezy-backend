import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";

export type FtsSearchRecipesPayload = string;

export const useFtsSearchRecipes = () => {
  return useMutation({
    mutationFn: async (payload: FtsSearchRecipesPayload) => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name")
        .textSearch("name", payload, { type: "websearch" });

      console.log("data", data);

      if (error) {
        console.error("[useSearchRecipes]:", error);
        throw error;
      }

      return data;
    },
  });
};
