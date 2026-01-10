import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { TablesUpdate } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type UpdateProfileSettingsPayload = Omit<
  TablesUpdate<"profile_settings">,
  "profile_id"
>;

export const useUpdateProfileSettings = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: UpdateProfileSettingsPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("profile_settings")
        .update(payload)
        .eq("profile_id", profile.data.id);

      if (error) {
        console.error("Error updating profile settings:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "profile_settings"],
      });
    },
    retry: false,
  });
};
