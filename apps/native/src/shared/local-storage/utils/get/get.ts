import AsyncStorage from "@react-native-async-storage/async-storage";

import { parse } from "../parse";

export const get = async <T>(key: string, defaultValue: T): Promise<T> => {
  const raw = await AsyncStorage.getItem(key);

  return raw ? parse(raw, defaultValue) : defaultValue;
};
