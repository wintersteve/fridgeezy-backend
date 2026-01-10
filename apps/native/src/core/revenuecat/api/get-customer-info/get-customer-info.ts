import Purchases from "react-native-purchases";

export const getCustomerInfo = async () => {
  return await Purchases.getCustomerInfo();
};
