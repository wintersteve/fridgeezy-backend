import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertShoppingListPayload = Omit<
  TablesInsert<"shopping_lists">,
  "profile_id"
>;

export const useInsertShoppingList = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: InsertShoppingListPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("shopping_lists")
        .insert({ ...payload, profile_id: profile.data.id });

      if (error) {
        console.error("Error inserting shopping list:", error);
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
