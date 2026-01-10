import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/core/supabase";
import { Tables } from "@/shared/supabase/types";
import { castArray } from "@/shared/toolkit";

import { supabase } from "../../constants";

export type DeleteCollectionPayload =
  | Tables<"collections">["id"]
  | Tables<"collections">["id"][];

export const useDeleteCollection = () => {
  const queryClient = useQueryClient();

  const profile = useProfile();

  return useMutation({
    mutationFn: async (payload: DeleteCollectionPayload) => {
      if (!profile.data?.id) {
        throw new Error("Profile not loaded");
      }

      const ids = castArray(payload);

      if (!ids.length) {
        return null;
      }

      const { data, error } = await supabase
        .from("collections")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("Error deleting collection:", error);
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["supabase", "collections"],
      });
    },
    retry: false,
  });
};
