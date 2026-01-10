import { useQuery } from "@tanstack/react-query";

import { useGetAppUserId } from "@/core/revenuecat/hooks/use-get-app-user-id";

import { getCustomerInfo } from "../../api/get-customer-info";

export const useGetCustomerInfo = () => {
  const appUserId = useGetAppUserId();

  return useQuery({
    queryKey: ["REVENUECAT", "CUSTOMER_INFO", appUserId.data],
    queryFn: () => getCustomerInfo(),
    enabled: Boolean(appUserId.data),
  });
};
