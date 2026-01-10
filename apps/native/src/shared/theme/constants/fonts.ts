import { MD3Type } from "react-native-paper/src/types";

// Font family constants for consistency
const FONT_REGULAR = "Poppins_400Regular";
const FONT_SEMI_BOLD = "Poppins_600SemiBold";
const FONT_BOLD = "Poppins_700Bold";

export const FONTS: Record<string, Partial<MD3Type>> = {
  default: {
    fontFamily: FONT_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.25,
    fontWeight: "400",
  },

  // Display - Hero text, large headings
  displayLarge: {
    fontFamily: FONT_BOLD,
    fontSize: 48,
    lineHeight: 56,
    letterSpacing: -0.5,
    fontWeight: "700",
  },
  displayMedium: {
    fontFamily: FONT_BOLD,
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -0.25,
    fontWeight: "700",
  },
  displaySmall: {
    fontFamily: FONT_BOLD,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: 0,
    fontWeight: "700",
  },

  // Headline - Section headers
  headlineLarge: {
    fontFamily: FONT_BOLD,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: 0,
    fontWeight: "700",
  },
  headlineMedium: {
    fontFamily: FONT_BOLD,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: 0,
    fontWeight: "700",
  },
  headlineSmall: {
    fontFamily: FONT_BOLD,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: 0,
    fontWeight: "700",
  },

  // Title - Card titles, list headers
  titleLarge: {
    fontFamily: FONT_BOLD,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: 0,
    fontWeight: "700",
  },
  titleMedium: {
    fontFamily: FONT_BOLD,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.15,
    fontWeight: "700",
  },
  titleSmall: {
    fontFamily: FONT_BOLD,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: "700",
  },

  // Label - Buttons, tabs, chips
  labelLarge: {
    fontFamily: FONT_BOLD,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: "700",
  },
  labelMedium: {
    fontFamily: FONT_BOLD,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    fontWeight: "700",
  },
  labelSmall: {
    fontFamily: FONT_BOLD,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    fontWeight: "700",
  },

  // Body - Paragraph text, descriptions
  bodyLarge: {
    fontFamily: FONT_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.5,
    fontWeight: "400",
  },
  bodyMedium: {
    fontFamily: FONT_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.25,
    fontWeight: "400",
  },
  bodySmall: {
    fontFamily: FONT_REGULAR,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
    fontWeight: "400",
  },
} as const;
