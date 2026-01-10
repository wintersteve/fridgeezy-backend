import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type InsertPromptPayload = {
  prompt: string;
};

export const useInsertPrompt = () => {
  const queryClient = useQueryClient();
  const profile = useProfile();

  return useMutation({
    mutationFn: async (
      payload: InsertPromptPayload,
    ): Promise<Tables<"prompts">> => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      // Get current count to determine position
      const { count } = await supabase
        .from("prompts")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profile.data.id);

      if (count !== null && count >= 3) {
        throw new Error("Maximum of 3 prompts allowed");
      }

      const position = count ?? 0;

      const { data, error } = await supabase
        .from("prompts")
        .insert({ ...payload, profile_id: profile.data.id, position })
        .select()
        .single();

      if (error) {
        console.error("Error inserting prompt:", error);
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
