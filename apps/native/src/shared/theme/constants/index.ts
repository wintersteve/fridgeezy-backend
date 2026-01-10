import { configureFonts, DefaultTheme } from "react-native-paper";

import { COLORS } from "./colors";
import { FONTS } from "./fonts";

export const THEME_LIGHT = {
  ...DefaultTheme,
  colors: { ...COLORS.COMMON, ...COLORS.LIGHT },
  fonts: configureFonts({ config: FONTS, isV3: true }),
};

export const THEME_DARK = {
  ...DefaultTheme,
  colors: { ...COLORS.COMMON, ...COLORS.DARK },
  fonts: configureFonts({ config: FONTS, isV3: true }),
};
