import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export type DietaryPreferences = Tables<"profile_dietary_preferences">;

export const useProfileDietaryPreferences = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase
        .from("profile_dietary_preferences")
        .select("*, tag:tag_id(name)");

      return data ?? [];
    },
    queryKey: ["supabase", "profile_dietary_preferences", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
