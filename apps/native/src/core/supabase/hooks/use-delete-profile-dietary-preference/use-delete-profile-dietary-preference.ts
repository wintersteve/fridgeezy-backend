import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

export type DeleteProfileDietaryPreferencePayload =
  | Tables<"profile_dietary_preferences">["id"]
  | Tables<"profile_dietary_preferences">["id"][];

export const useDeleteProfileDietaryPreference = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: DeleteProfileDietaryPreferencePayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("profile_dietary_preferences")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting dietary preferences:", error);
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
