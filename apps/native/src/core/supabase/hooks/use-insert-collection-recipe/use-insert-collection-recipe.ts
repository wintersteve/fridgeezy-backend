import { useMutation, useQueryClient } from "@tanstack/react-query";

import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertCollectionRecipePayload =
  | TablesInsert<"collection_recipes">
  | TablesInsert<"collection_recipes">[];

export const useInsertCollectionRecipe = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: InsertCollectionRecipePayload) => {
      const items = Array.isArray(payload) ? payload : [payload];

      const { data, error } = await supabase
        .from("collection_recipes")
        .insert(items)
        .select();

      if (error) {
        console.error("Error inserting collection recipe:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async (_, variables) => {
      const items = Array.isArray(variables) ? variables : [variables];
      const collectionIds = [
        ...new Set(items.map((item) => item.collection_id)),
      ];

      await Promise.all([
        ...collectionIds.map((id) =>
          queryClient.invalidateQueries({
            queryKey: ["supabase", "collection_recipes", id],
          }),
        ),
        queryClient.invalidateQueries({
          queryKey: ["supabase", "collections"],
        }),
      ]);
    },
    retry: false,
  });
};
