import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type UpdatePromptPayload = {
  id: string;
  prompt: string;
};

export const useUpdatePrompt = () => {
  const queryClient = useQueryClient();
  const profile = useProfile();

  return useMutation({
    mutationFn: async ({
      id,
      prompt,
    }: UpdatePromptPayload): Promise<Tables<"prompts">> => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const { data, error } = await supabase
        .from("prompts")
        .update({ prompt })
        .eq("id", id)
        .eq("profile_id", profile.data.id)
        .select()
        .single();

      if (error) {
        console.error("Error updating prompt:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "prompts"],
      });
    },
    retry: false,
  });
};
