import { useQuery } from "@tanstack/react-query";

import { supabase } from "../../constants";

const fetcher = async () => {
  const { data, error } = await supabase.auth.getSession();

  if (!data.session) throw new Error("Not logged in");

  if (error) throw new Error(error.message);

  return data.session.user ?? null;
};

export const useUser = () => {
  return useQuery({
    queryKey: ["SUPABASE", "USER"],
    queryFn: fetcher,
    retry: false,
  });
};
