import { PurchasesPackage } from "@revenuecat/purchases-typescript-internal";
import { useMutation } from "@tanstack/react-query";

import { purchaseOffering } from "@/core/revenuecat/api/purchase-offering";

export const usePurchaseOffering = () => {
  return useMutation({
    mutationFn: (offering: PurchasesPackage) => purchaseOffering(offering),
  });
};
