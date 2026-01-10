import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export const usePrompts = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("prompts")
        .select("*, prompt_variables(*)")
        .order("position", { ascending: true });

      return data ?? [];
    },
    queryKey: ["supabase", "prompts", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
