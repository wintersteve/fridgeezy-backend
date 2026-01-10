import { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Layout } from "@/shared/ui";

export interface AuthLayoutProps {
  button: ReactNode;
  children: ReactNode;
  description: ReactNode;
}

export const AuthLayout = (props: AuthLayoutProps) => {
  const { button, children, description } = props;

  const insets = useSafeAreaInsets();

  const { colors } = useTheme();

  return (
    <Layout enableTopInsets={false} spacing={0}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flex: 1,
            zIndex: 2,
            marginTop: insets.top + 64,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.onBackgroundVariant,
                marginHorizontal: 20,
                marginTop: 24,
                left: -2,
              }}
              variant="bodyMedium"
            >
              {description}
            </Text>

            {children}

            <View
              style={{
                marginTop: "auto",
                marginHorizontal: 12,
                paddingBottom: 40,
              }}
            >
              {button}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Layout>
  );
};
