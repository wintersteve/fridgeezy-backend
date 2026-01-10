import { useQuery } from "@tanstack/react-query";

import { Tables } from "@/shared/supabase/types";

import { supabase } from "../../constants";
import { useUser } from "../use-user";

export const useCollection = (id: string | undefined) => {
  const user = useUser();

  return useQuery({
    queryFn: async () => {
      if (!id) return null;

      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        console.error("Error fetching collection:", error);
        throw error;
      }

      return data as Tables<"collections">;
    },
    queryKey: ["supabase", "collections", id],
    enabled: Boolean(user.data?.id) && Boolean(id),
  });
};
