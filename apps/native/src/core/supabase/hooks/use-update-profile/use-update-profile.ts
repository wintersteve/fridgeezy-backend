import { useMutation, useQueryClient } from "@tanstack/react-query";

import { TablesUpdate } from "@/shared/supabase/types";

import { supabase } from "../../constants";

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: TablesUpdate<"profiles">) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("No authenticated user");
      }

      const { data, error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("user_id", user.id);

      if (error) {
        console.error("Error updating profile:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "profiles"],
      });
    },
    retry: false,
  });
};
