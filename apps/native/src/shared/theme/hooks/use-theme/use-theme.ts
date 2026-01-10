import { THEME_LIGHT, THEME_DARK } from "../../constants";
import { useThemeStorage } from "../use-theme-storage";

export const useTheme = () => {
  const storage = useThemeStorage();

  return storage.data === "LIGHT" ? THEME_LIGHT : THEME_DARK;
};
