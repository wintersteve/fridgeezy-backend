import { Platform } from "react-native";

export const REVENUECAT_API_KEY = Platform.select({
  ios: "appl_PypeQOMORvQsbBRjpYvbkohzRuH",
  android: "",
  default: "",
});
