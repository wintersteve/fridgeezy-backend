import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

type DeleteById =
  | Tables<"shopping_lists">["id"]
  | Tables<"shopping_lists">["id"][];

type DeleteByRecipe = {
  recipe_id: string;
};

export type DeleteShoppingListPayload = DeleteById | DeleteByRecipe;

const isDeleteByRecipe = (
  payload: DeleteShoppingListPayload,
): payload is DeleteByRecipe => {
  return typeof payload === "object" && "recipe_id" in payload;
};

export const useDeleteShoppingList = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: DeleteShoppingListPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      if (isDeleteByRecipe(payload)) {
        const { data, error } = await supabase
          .from("shopping_lists")
          .delete()
          .eq("profile_id", profile.data.id)
          .eq("recipe_id", payload.recipe_id);

        if (error) {
          console.error("Error deleting shopping list:", error);
          throw error;
        }

        return data;
      }

      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("shopping_lists")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting shopping list:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "shopping_lists"],
      });
    },
    retry: false,
  });
};
