import { useQuery } from "@tanstack/react-query";

import { Database } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

type InteractionType = Database["public"]["Enums"]["recipe_interaction_type"];

export const useProfileRecipeInteractions = (
  interactionType?: InteractionType,
) => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      let query = supabase.from("profile_recipe_interactions").select("*");

      if (interactionType) {
        query = query.eq("interaction_type", interactionType);
      }

      const { data } = await query;

      return data ?? [];
    },
    queryKey: [
      "supabase",
      "profile_recipe_interactions",
      user.data?.id,
      interactionType,
    ],
    enabled: Boolean(user.data?.id),
  });
};
