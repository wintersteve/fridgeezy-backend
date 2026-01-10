import AsyncStorage from "@react-native-async-storage/async-storage";

export const set = async <T>(key: string, value: T) => {
  const data = JSON.stringify(value);

  await AsyncStorage.setItem(key, data);
};
