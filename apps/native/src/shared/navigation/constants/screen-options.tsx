import { HeaderLeft, HeaderLeftProps } from "../components/header-left";

import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

type Colors = {
  background: string;
  primary: string;
  onBackground: string;
};

/**
 * Base header styling options - used across most stack navigators
 */
export const getBaseHeaderOptions = (
  colors: Colors,
): NativeStackNavigationOptions => ({
  headerShown: false,
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.primary,
  headerTitleStyle: {
    color: colors.onBackground,
    fontFamily: "Poppins_700Bold",
  },
  headerLargeTitleStyle: { fontFamily: "Poppins_700Bold" },
  headerShadowVisible: false,
});

/**
 * Stack options with hidden header and themed background
 */
export const getHiddenHeaderOptions = (
  colors: Colors,
): NativeStackNavigationOptions => ({
  contentStyle: { backgroundColor: colors.background },
});

/**
 * Full stack options including base header + content styling + hidden header
 * Used by root layout and other top-level stacks
 */
export const getDefaultStackOptions = (
  colors: Colors,
): NativeStackNavigationOptions => ({
  ...getBaseHeaderOptions(colors),
  ...getHiddenHeaderOptions(colors),
});

/**
 * Screen with large title header - used for main screens
 *
 * NOTE: Screens using this option should:
 * 1. Use ScrollView with contentInsetAdjustmentBehavior="automatic"
 * 2. NOT add manual paddingTop based on insets
 * 3. Let iOS manage header spacing automatically
 */
export const getLargeTitleScreenOptions = (
  title: string,
): NativeStackNavigationOptions => ({
  headerShown: true,
  headerTitle: title,
  headerLargeTitle: true,
  headerBackButtonDisplayMode: "minimal",
  headerLargeTitleShadowVisible: false,
});

/**
 * Settings sub-screen options - card presentation with back navigation
 */
export const getSettingsCardOptions = (
  title: string,
): NativeStackNavigationOptions => ({
  presentation: "card",
  headerTitle: title,
  headerShown: true,
  headerBackTitle: "Settings",
  headerBackVisible: true,
});

export interface GetCustomLayoutOptions extends Pick<HeaderLeftProps, "icon"> {
  title?: string;
}

export const getCustomLayoutOptions = (options?: GetCustomLayoutOptions) => {
  const { icon, title = "" } = options ?? {};

  return {
    headerLeft: () => <HeaderLeft icon={icon} />,
    headerShown: true,
    headerLargeTitle: true,
    title,
  };
};
