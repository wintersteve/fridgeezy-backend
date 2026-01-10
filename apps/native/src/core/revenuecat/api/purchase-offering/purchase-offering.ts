import { PurchasesPackage } from "@revenuecat/purchases-typescript-internal";
import Purchases from "react-native-purchases";

export const purchaseOffering = async (offering: PurchasesPackage) => {
  return await Purchases.purchasePackage(offering);
};
