import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/core/supabase";

export type VectorSearchRecipesPayload = {
  query: string;
  signal: AbortSignal;
};

export const useVectorSearchRecipes = () => {
  return useMutation({
    mutationFn: async (payload: VectorSearchRecipesPayload) => {
      const { data, error } = await supabase
        .rpc("search_recipes", {
          search_query: payload.query.toLowerCase(),
        })
        .abortSignal(payload.signal);

      if (error) {
        console.error("[useVectorSearchRecipes]:", error);
        throw error;
      }

      return data;
    },
  });
};
