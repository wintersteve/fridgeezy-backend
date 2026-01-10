import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";

import { supabase } from "../../constants";

export type ReorderPromptsPayload = { id: string; position: number }[];

export const useReorderPrompts = () => {
  const queryClient = useQueryClient();
  const profile = useProfile();

  return useMutation({
    mutationFn: async (updates: ReorderPromptsPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      // Update each prompt's position
      for (const { id, position } of updates) {
        const { error } = await supabase
          .from("prompts")
          .update({ position })
          .eq("id", id)
          .eq("profile_id", profile.data.id);

        if (error) {
          console.error("Error reordering prompts:", error);
          throw error;
        }
      }

      return null;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "prompts"],
      });
    },
    retry: false,
  });
};
