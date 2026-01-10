import Slider from "@react-native-community/slider";
import { useNavigation } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useProfileSettings, useUpdateProfileSettings } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { Button, Card, Section } from "@/shared/ui";

export interface ServingsEditorProps {}

export const ServingsEditor = () => {
  const navigation = useNavigation();

  const { colors } = useTheme();

  const insets = useSafeAreaInsets();

  const profileSettings = useProfileSettings();

  const updateProfileSettings = useUpdateProfileSettings();

  const [localServings, setLocalServings] = useState<number | undefined>();

  const servings = localServings ?? profileSettings.data?.servings ?? 2;

  const hasChanged =
    localServings !== undefined &&
    localServings !== profileSettings.data?.servings;

  const handleSliderChange = (value: number) => {
    setLocalServings(Math.round(value));
  };

  const handleConfirm = () => {
    if (hasChanged && localServings) {
      updateProfileSettings.mutate({ servings: localServings });
    }
    navigation.goBack();
  };

  return (
    <View style={{ flex: 1, paddingTop: 8 }}>
      <Section title="Default Servings" style={{ marginHorizontal: 12 }}>
        <Card contentStyle={{ padding: 24 }}>
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: colors.primaryContainer,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginBottom: 4,
            }}
          >
            <Text style={{ color: colors.primary }} variant="titleMedium">
              {servings} {servings === 1 ? "Serving" : "Servings"}
            </Text>
          </View>

          <Slider
            style={{ width: "100%", height: 40 }}
            minimumValue={1}
            maximumValue={8}
            step={1}
            value={servings}
            onValueChange={handleSliderChange}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.outline}
            thumbTintColor={colors.primary}
          />
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            Select the default serving size for your recipes
          </Text>
        </Card>
      </Section>
      <Button
        disabled={!hasChanged}
        style={{ marginBottom: insets.bottom, marginHorizontal: 20 }}
        onPress={handleConfirm}
      >
        Confirm
      </Button>
    </View>
  );
};
