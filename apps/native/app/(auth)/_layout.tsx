import { Redirect, Stack } from "expo-router";
import "react-native-reanimated";

import { useUser } from "@/core/supabase";
import {
  getCustomLayoutOptions,
  getDefaultStackOptions,
} from "@/shared/navigation";
import { useTheme } from "@/shared/theme";

export default function Layout() {
  const { colors } = useTheme();
  const user = useUser();

  // Wait for auth validation
  if (user.isLoading) {
    return null;
  }

  // Redirect to home if already authenticated
  if (user.data) {
    return <Redirect href="/" />;
  }

  return (
    <Stack screenOptions={getDefaultStackOptions(colors)}>
      <Stack.Screen
        name="login/email"
        options={getCustomLayoutOptions({
          title: "Enter Email",
          icon: "email-edit",
        })}
      />
      <Stack.Screen
        name="login/password"
        options={getCustomLayoutOptions({
          title: "Enter Password",
          icon: "lock-check",
        })}
      />
      <Stack.Screen
        name="sign-up/password"
        options={getCustomLayoutOptions({
          title: "Create Password",
          icon: "lock-plus",
        })}
      />
    </Stack>
  );
}
