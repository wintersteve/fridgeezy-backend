import { useEffect, useState } from "react";

import { clear } from "../../utils/clear";
import { get } from "../../utils/get";
import { set as setStorage } from "../../utils/set";

export interface UseStorageArgs<T> {
  defaultValue: T;
}

export const useStorage = <T>(key: string, args: UseStorageArgs<T>) => {
  const { defaultValue } = args;

  const [data, setData] = useState<T>(defaultValue);

  const set = async (value: T) => {
    await setStorage(key, value);
    setData(value);
  };

  useEffect(() => {
    get(key, defaultValue).then(setData);
  }, []);

  return { data, clear, set };
};
