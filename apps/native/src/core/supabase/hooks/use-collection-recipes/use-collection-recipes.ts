import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export type CollectionRecipeWithDetails = Tables<"collection_recipes"> & {
  recipe: Tables<"recipes"> | null;
};

export const useCollectionRecipes = (collectionId: string | undefined) => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      if (!collectionId) return [];

      const { data, error } = await supabase
        .from("collection_recipes")
        .select("*, recipe:recipe_id(*)")
        .eq("collection_id", collectionId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching collection recipes:", error);
        throw error;
      }

      return (data as CollectionRecipeWithDetails[]) ?? [];
    },
    queryKey: ["supabase", "collection_recipes", collectionId],
    enabled: Boolean(user.data?.id) && Boolean(collectionId),
  });
};
