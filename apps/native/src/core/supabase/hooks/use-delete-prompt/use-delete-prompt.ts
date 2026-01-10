import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export type DeletePromptPayload = Tables<"prompts">["id"];

export const useDeletePrompt = () => {
  const queryClient = useQueryClient();
  const profile = useProfile();

  return useMutation({
    mutationFn: async (id: DeletePromptPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      // Get the prompt to delete to know its position
      const { data: promptToDelete } = await supabase
        .from("prompts")
        .select("position")
        .eq("id", id)
        .single();

      if (!promptToDelete) {
        throw new Error("Prompt not found");
      }

      // Delete the prompt
      const { error: deleteError } = await supabase
        .from("prompts")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error("Error deleting prompt:", deleteError);
        throw deleteError;
      }

      // Update positions of remaining prompts
      const { error: updateError } = await supabase
        .from("prompts")
        .update({ position: supabase.rpc ? undefined : undefined })
        .gt("position", promptToDelete.position)
        .eq("profile_id", profile.data.id);

      // Refetch and reorder remaining prompts
      const { data: remaining } = await supabase
        .from("prompts")
        .select("id, position")
        .eq("profile_id", profile.data.id)
        .order("position", { ascending: true });

      if (remaining && remaining.length > 0) {
        // Update each prompt's position to be sequential
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].position !== i) {
            await supabase
              .from("prompts")
              .update({ position: i })
              .eq("id", remaining[i].id);
          }
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
