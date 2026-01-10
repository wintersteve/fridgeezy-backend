import AsyncStorage from "@react-native-async-storage/async-storage";

export const clear = async (key: string) => {
  await AsyncStorage.removeItem(key);
};
