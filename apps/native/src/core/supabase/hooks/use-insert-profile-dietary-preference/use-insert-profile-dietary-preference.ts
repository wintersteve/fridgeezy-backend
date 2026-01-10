import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesInsert } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertProfileDietaryPreferencePayload = Omit<
  TablesInsert<"profile_dietary_preferences">,
  "profile_id"
>;

export const useInsertProfileDietaryPreference = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: InsertProfileDietaryPreferencePayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("profile_dietary_preferences")
        .insert({ ...payload, profile_id: profile.data.id });

      if (error) {
        console.error("Error updating profile:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "profile_dietary_preferences"],
      });
    },
    retry: false,
  });
};
