import { ReactNode, useEffect } from "react";
import Purchases from "react-native-purchases";

import { useUser } from "@/core/supabase";

import { REVENUECAT_API_KEY } from "../constants";

export interface RevenuecatProvidersProps {
  children: ReactNode;
}

export const RevenuecatProviders = (props: RevenuecatProvidersProps) => {
  const { children } = props;

  const user = useUser();

  useEffect(() => {
    if (user.data?.id) {
      Purchases.configure({
        apiKey: REVENUECAT_API_KEY,
        appUserID: user.data?.id,
      });
    }
  }, [user.data?.id]);

  return <>{children}</>;
};
