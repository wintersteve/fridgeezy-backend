import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export const useProfile = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").single();

      return data;
    },
    queryKey: ["supabase", "profiles", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
