import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

export type DeleteCollectionRecipePayload =
  | Tables<"collection_recipes">["id"]
  | Tables<"collection_recipes">["id"][];

export const useDeleteCollectionRecipe = (collectionId: string | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DeleteCollectionRecipePayload) => {
      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("collection_recipes")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting collection recipe:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["supabase", "collection_recipes", collectionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["supabase", "collections"],
        }),
      ]);
    },
    retry: false,
  });
};
