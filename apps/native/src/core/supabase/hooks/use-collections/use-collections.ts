import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export type CollectionWithRecipeCount = Tables<"collections"> & {
  recipeCount: number;
};

export const useCollections = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("*, collection_recipes(count)")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching collections:", error);
        throw error;
      }

      return (data ?? []).map((collection) => ({
        ...collection,
        recipeCount:
          (collection.collection_recipes as unknown as { count: number }[])?.[0]
            ?.count ?? 0,
      })) as CollectionWithRecipeCount[];
    },
    queryKey: ["supabase", "collections", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
