import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

type DeleteById = Tables<"pantry_items">["id"] | Tables<"pantry_items">["id"][];

type DeleteByIngredient = {
  ingredient_id: string;
};

export type DeletePantryItemPayload = DeleteById | DeleteByIngredient;

const isDeleteByIngredient = (
  payload: DeletePantryItemPayload,
): payload is DeleteByIngredient => {
  return typeof payload === "object" && "ingredient_id" in payload;
};

export const useDeletePantryItem = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: DeletePantryItemPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      if (isDeleteByIngredient(payload)) {
        const { data, error } = await supabase
          .from("pantry_items")
          .delete()
          .eq("profile_id", profile.data.id)
          .eq("ingredient_id", payload.ingredient_id);

        if (error) {
          console.error("Error deleting pantry item:", error);
          throw error;
        }

        return data;
      }

      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("pantry_items")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting pantry item:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "pantry_items"],
      });
    },
    retry: false,
  });
};
