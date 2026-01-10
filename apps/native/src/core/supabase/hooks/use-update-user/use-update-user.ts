import { useMutation } from "@tanstack/react-query";

import { supabase } from "../../constants";

export const useUpdateUser = () => {
  return useMutation({
    mutationFn: async (data: object) => {
      const response = await supabase.auth.updateUser({ data });

      if (response.error) {
        console.error("Error updating user:", response.error);
        throw response.error;
      }

      return response.data;
    },
    retry: false,
  });
};
