import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";

export const usePromptVariableTypes = () => {
  return useQuery({
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_prompt_variable_types");

      if (error) {
        console.error("Error fetching prompt variable types:", error);
        throw error;
      }

      return data ?? [];
    },
    queryKey: ["supabase", "prompt-variable-types"],
    staleTime: Infinity,
  });
};
