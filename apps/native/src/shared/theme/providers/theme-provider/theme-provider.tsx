import { PropsWithChildren } from "react";
import { PaperProvider } from "react-native-paper";

import { THEME_LIGHT, THEME_DARK } from "../../constants";
import { useThemeStorage } from "../../hooks/use-theme-storage";

export const ThemeProvider = (props: PropsWithChildren) => {
  const { children } = props;
  const storage = useThemeStorage();
  const theme = storage.data === "LIGHT" ? THEME_LIGHT : THEME_DARK;

  return <PaperProvider theme={theme}>{children}</PaperProvider>;
};
