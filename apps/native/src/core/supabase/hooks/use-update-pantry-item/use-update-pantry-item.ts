import { useMutation, useQueryClient } from "@tanstack/react-query";

import { TablesUpdate } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type UpdatePantryItemPayload = {
  id: string;
  updates: TablesUpdate<"pantry_items">;
};

export const useUpdatePantryItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdatePantryItemPayload) => {
      const { id, updates } = payload;

      const { data, error } = await supabase
        .from("pantry_items")
        .update(updates)
        .eq("id", id)
        .select();

      if (error) {
        console.error("Error updating pantry item:", error);
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
