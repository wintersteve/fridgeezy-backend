import { useMutation } from "@tanstack/react-query";

import { supabase } from "../../constants";

const fetcher = async (email: string) => {
  const { data, error } = await supabase.rpc("has_user", { email });

  if (error) {
    console.error("Error checking email:", error);
    throw error;
  }

  return data;
};

export const useUserEmail = () => {
  return useMutation({
    mutationFn: (email: string) => fetcher(email),
    retry: false,
  });
};
