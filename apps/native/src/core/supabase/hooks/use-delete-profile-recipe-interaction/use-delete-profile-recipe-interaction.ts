import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Database, Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

type DeleteById =
  | Tables<"profile_recipe_interactions">["id"]
  | Tables<"profile_recipe_interactions">["id"][];

type DeleteByRecipe = {
  recipe_id: string;
  interaction_type: Database["public"]["Enums"]["recipe_interaction_type"];
};

export type DeleteProfileRecipeInteractionPayload = DeleteById | DeleteByRecipe;

const isDeleteByRecipe = (
  payload: DeleteProfileRecipeInteractionPayload,
): payload is DeleteByRecipe => {
  return typeof payload === "object" && "recipe_id" in payload;
};

export const useDeleteProfileRecipeInteraction = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: DeleteProfileRecipeInteractionPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      if (isDeleteByRecipe(payload)) {
        const { data, error } = await supabase
          .from("profile_recipe_interactions")
          .delete()
          .eq("profile_id", profile.data.id)
          .eq("recipe_id", payload.recipe_id)
          .eq("interaction_type", payload.interaction_type);

        if (error) {
          console.error("Error deleting recipe interaction:", error);
          throw error;
        }

        return data;
      }

      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("profile_recipe_interactions")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting recipe interaction:", error);
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
