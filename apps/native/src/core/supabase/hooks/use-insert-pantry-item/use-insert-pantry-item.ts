import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertPantryItemPayload =
  | Omit<TablesInsert<"pantry_items">, "profile_id">
  | Omit<TablesInsert<"pantry_items">, "profile_id">[];

export const useInsertPantryItem = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: InsertPantryItemPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const items = Array.isArray(payload) ? payload : [payload];
      const insertData = items.map((item) => ({
        ...item,
        profile_id: profile.data!.id,
      }));

      const { data, error } = await supabase
        .from("pantry_items")
        .insert(insertData);

      if (error) {
        console.error("Error inserting pantry item:", error);
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
