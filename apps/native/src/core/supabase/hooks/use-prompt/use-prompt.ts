import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";

export interface UsePromptOptions {
  id?: string;
}

export const usePrompt = (options: UsePromptOptions) => {
  const { id } = options;

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("prompts")
        .select("*, prompt_variables(*)")
        .eq("id", id!)
        .single();

      return data ?? null;
    },
    queryKey: ["supabase", "prompts", id],
    enabled: Boolean(id),
  });
};
