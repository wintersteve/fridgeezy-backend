import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "../../constants";

export const useDeletePromptVariables = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (promptId: string) => {
      const { error } = await supabase
        .from("prompt_variables")
        .delete()
        .eq("prompt_id", promptId);

      if (error) {
        console.error("Error deleting prompt variables:", error);
        throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "prompts"],
      });
    },
    retry: false,
  });
};
