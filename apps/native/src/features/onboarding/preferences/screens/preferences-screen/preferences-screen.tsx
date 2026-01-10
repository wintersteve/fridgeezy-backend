import { useRouter } from "expo-router";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { AuthLayout } from "@/features/auth";
import { useDietaryPreferencesEditor } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { Button, Card, ScrollView, Tags } from "@/shared/ui";

export const PreferencesScreen = () => {
  const theme = useTheme();

  const router = useRouter();

  const editor = useDietaryPreferencesEditor();

  const handleContinue = async () => {
    await editor.save();
    router.push("/(onboarding)/blacklist");
  };

  return (
    <AuthLayout
      button={<Button onPress={handleContinue}>Continue</Button>}
      description="Tell us how you eat so we can recommend recipes that fit your
          lifestyle.
"
    >
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <ScrollView style={{ flex: 1 }}>
          <Text
            variant="headlineMedium"
            style={{
              color: theme.colors.onBackgroundVariant,
              marginLeft: 6,
              marginBottom: 4,
            }}
          >
            {editor.selected.length} Selected
          </Text>
          <Card contentStyle={{ padding: 12 }}>
            <Tags
              data={editor.tags}
              isLoading={editor.isLoading}
              onPress={editor.toggle}
              selected={editor.selected}
            />
          </Card>
        </ScrollView>
      </View>
    </AuthLayout>
  );
};
