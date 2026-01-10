import { Redirect, Stack } from "expo-router";
import "react-native-reanimated";

import { useUser } from "@/core/supabase";
import {
  getBaseHeaderOptions,
  getCustomLayoutOptions,
} from "@/shared/navigation";
import { useTheme } from "@/shared/theme";

export default function Layout() {
  const { colors } = useTheme();

  const user = useUser();

  // Wait for auth validation
  if (user.isLoading) {
    return null;
  }

  // Redirect to welcome if not authenticated
  if (!user.data) {
    return <Redirect href="/welcome" />;
  }

  return (
    <Stack
      screenOptions={{ ...getBaseHeaderOptions(colors), headerShown: false }}
    >
      <Stack.Screen
        name="confirmation"
        options={getCustomLayoutOptions({
          title: "All set",
          icon: "check-bold",
        })}
      />
      <Stack.Screen
        name="blacklist"
        options={getCustomLayoutOptions({
          title: "Blacklist",
          icon: "food-variant-off",
        })}
      />
      <Stack.Screen
        name="details"
        options={getCustomLayoutOptions({
          title: "Enter Name",
          icon: "card-account-details",
        })}
      />
      <Stack.Screen
        name="preferences"
        options={getCustomLayoutOptions({
          title: "Dietary Preferences",
          icon: "barley-off",
        })}
      />
      <Stack.Screen
        name="settings"
        options={getCustomLayoutOptions({
          title: "Preferences",
          icon: "cog",
        })}
      />
      <Stack.Screen
        name="skill"
        options={getCustomLayoutOptions({
          title: "Skill",
          icon: "food-variant-off",
        })}
      />
      <Stack.Screen
        name="subscription"
        options={getCustomLayoutOptions({
          title: "Subscription",
          icon: "plus-thick",
        })}
      />
    </Stack>
  );
}
