import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertCollectionPayload = Omit<
  TablesInsert<"collections">,
  "profile_id"
>;

export const useInsertCollection = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: InsertCollectionPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("collections")
        .insert({
          ...payload,
          profile_id: profile.data.id,
        })
        .select()
        .single();

      if (error) {
        console.error("Error inserting collection:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "collections"],
      });
    },
    retry: false,
  });
};
