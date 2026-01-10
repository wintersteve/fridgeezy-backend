import Constants from "expo-constants";

export const isReleased =
  Constants.executionEnvironment === "standalone" ||
  Constants.executionEnvironment === "storeClient";
