import { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Layout } from "@/shared/ui";

export interface InputLayoutProps {
  button: ReactNode;
  description: ReactNode;
  input: ReactNode;
}

export const InputLayout = (props: InputLayoutProps) => {
  const { button, description, input } = props;

  const insets = useSafeAreaInsets();

  const { colors } = useTheme();

  return (
    <Layout
      contentInsetAdjustmentBehavior="never"
      enableTopInsets={false}
      spacing={0}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flex: 1,
            zIndex: 2,
            marginTop: insets.top + 80,
          }}
        >
          <View style={{ gap: 14, marginTop: 24, marginHorizontal: 20 }}>
            {input}
          </View>
          <Text
            style={{
              color: colors.onSurfaceVariant,
              marginHorizontal: 24,
              marginTop: 12,
            }}
            variant="bodyMedium"
          >
            {description}
          </Text>
          <View
            style={{
              marginTop: "auto",
              marginHorizontal: 12,
              paddingBottom: 24,
            }}
          >
            {button}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Layout>
  );
};
