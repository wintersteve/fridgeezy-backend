import { useMemo } from "react";

import { useCollections, useProfileRecipeInteractions } from "@/core/supabase";

export interface CookingStats {
  totalCooked: number;
  totalFavorites: number;
  totalCollections: number;
}

export const useCookingStats = (): CookingStats => {
  const cooked = useProfileRecipeInteractions("cooked");
  const favorites = useProfileRecipeInteractions("favourite");
  const collections = useCollections();

  return useMemo(
    () => ({
      totalCooked: cooked.data?.length ?? 0,
      totalFavorites: favorites.data?.length ?? 0,
      totalCollections: collections.data?.length ?? 0,
    }),
    [cooked.data?.length, favorites.data?.length, collections.data?.length],
  );
};
