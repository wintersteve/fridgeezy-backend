import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export type ProfileSettingsData = Tables<"profile_settings">;

export const useProfileSettings = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("profile_settings")
        .select("*")
        .single();

      return data;
    },
    queryKey: ["supabase", "profile_settings", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
