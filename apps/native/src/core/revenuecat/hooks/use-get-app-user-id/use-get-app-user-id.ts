import { useQuery } from "@tanstack/react-query";
import Purchases from "react-native-purchases";

import { useUser } from "@/core/supabase";

const getAppUserId = async () => {
  const isAnonymous = await Purchases.isAnonymous();

  if (isAnonymous) return null;

  return await Purchases.getAppUserID();
};

export const useGetAppUserId = () => {
  const user = useUser();

  return useQuery({
    queryKey: ["REVENUECAT", "APP_USER_ID"],
    queryFn: () => getAppUserId(),
    enabled: Boolean(user.data?.id),
  });
};
