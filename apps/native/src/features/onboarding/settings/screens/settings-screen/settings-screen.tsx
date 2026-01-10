import { useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { Button, Icon, Text } from "react-native-paper";

import { AuthLayout } from "@/features/auth";
import {
  BlacklistSetting,
  DietarySetting,
  ServingsSetting,
  SkillSetting,
  UnitSetting,
} from "@/shared/settings";
import { useTheme } from "@/shared/theme";
import { Card, Divider } from "@/shared/ui";

export const SettingsScreen = () => {
  const { colors } = useTheme();

  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();

  const handleContinue = () => {
    if (permission?.granted) {
      router.replace("/(onboarding)/details");
    } else {
      Alert.alert(
        "Permission required",
        "Please grant camera permissions to use Fridgeezy",
      );
    }
  };

  return (
    <AuthLayout enableBack={false}>
      <View style={{ flex: 1 }}>
        <Icon color={colors.onSurfaceVariant} source="cog-outline" size={32} />
        <Text variant="titleLarge" style={{ marginBottom: 4, marginTop: 8 }}>
          Settings
        </Text>

        <View style={styles.section}>
          <Text
            variant="titleSmall"
            style={[styles.sectionTitle, { color: colors.onBackgroundVariant }]}
          >
            Preferences
          </Text>
          <Card>
            <DietarySetting />
            <Divider color={colors.outline} style={styles.divider} />
            <BlacklistSetting />
            <Divider color={colors.outline} style={styles.divider} />
            <ServingsSetting />
            <Divider color={colors.outline} style={styles.divider} />
            <SkillSetting />
            <Divider color={colors.outline} style={styles.divider} />
            <UnitSetting />
          </Card>
        </View>

        <View style={{ marginTop: "auto", marginBottom: 48 }}>
          <Button
            mode="contained"
            onPress={handleContinue}
            textColor={colors.background}
            style={{ borderRadius: 50, paddingVertical: 8, shadowOpacity: 0.1 }}
          >
            Continue
          </Button>
        </View>
      </View>
    </AuthLayout>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 40,
    paddingHorizontal: 16,
    gap: 24,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
  },
  profileHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    padding: 16,
    paddingTop: 20,
  },
  profileInfo: {
    flex: 1,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    paddingHorizontal: 4,
    textTransform: "uppercase",
    fontSize: 13,
  },
  subscriptionImage: {
    borderRadius: 4,
    height: 40,
    width: 40,
  },
});
