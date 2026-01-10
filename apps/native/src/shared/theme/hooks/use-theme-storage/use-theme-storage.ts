import { useColorScheme } from "react-native";

import { useStorage } from "@/shared/local-storage";

export const useThemeStorage = () => {
  const colorScheme = useColorScheme();

  const defaultValue = colorScheme?.toUpperCase() ?? "LIGHT";

  return useStorage("THEME", { defaultValue });
};
