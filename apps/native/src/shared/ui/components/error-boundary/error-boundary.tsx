import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemeProvider, useTheme } from "@/shared/theme";
import { Button } from "@/shared/ui";

export interface ErrorScreenProps {
  retry?: () => void;
}

export const ErrorBoundary = (props: ErrorScreenProps) => {
  const { retry } = props;

  const { colors } = useTheme();

  const insets = useSafeAreaInsets();

  const router = useRouter();

  return (
    <ThemeProvider>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <View
            style={[
              styles.iconContainer,
              {
                backgroundColor: colors.errorContainer ?? "#FEE2E2",
                marginTop: "100%",
              },
            ]}
          >
            <Icon
              source="alert-circle-outline"
              size={48}
              color={colors.error}
            />
          </View>

          <View style={styles.textContainer}>
            <Text
              style={[styles.title, { color: colors.onSurface }]}
              variant="headlineMedium"
            >
              Something went wrong
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: colors.onSurfaceVariant, fontFamily: "Poppins" },
              ]}
            >
              An unexpected error occurred.{"\n"}Please try again.
            </Text>
          </View>

          <View
            style={{
              marginTop: "auto",
              marginBottom: insets.bottom,
              width: "100%",
            }}
          >
            {retry && <Button onPress={retry}>Try Again</Button>}
            {!retry && <Button onPress={() => router.back()}>Go Back</Button>}
          </View>
        </View>
      </View>
    </ThemeProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 24,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    alignItems: "center",
    flexGrow: 1,
    gap: 8,
  },
  title: {
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
    marginTop: 8,
  },
  buttonText: {
    fontSize: 15,
  },
});
