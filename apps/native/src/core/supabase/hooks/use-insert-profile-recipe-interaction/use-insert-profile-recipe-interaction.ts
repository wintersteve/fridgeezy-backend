import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertProfileRecipeInteractionPayload = Omit<
  TablesInsert<"profile_recipe_interactions">,
  "profile_id"
>;

export const useInsertProfileRecipeInteraction = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: InsertProfileRecipeInteractionPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("profile_recipe_interactions")
        .upsert(
          { ...payload, profile_id: profile.data.id },
          {
            onConflict: "profile_id,recipe_id,interaction_type",
            ignoreDuplicates: false,
          },
        );

      if (error) {
        console.error("Error upserting recipe interaction:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "profile_recipe_interactions"],
      });
    },
    retry: false,
  });
};
