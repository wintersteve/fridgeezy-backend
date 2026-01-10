import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export const useShoppingLists = () => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      const { data } = await supabase.from("shopping_lists").select("*");

      return data ?? [];
    },
    queryKey: ["supabase", "shopping_lists", user.data?.id],
    enabled: Boolean(user.data?.id),
  });
};
