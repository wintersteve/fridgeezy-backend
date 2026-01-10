import { Image, StyleSheet, View } from "react-native";
import { Avatar, Text } from "react-native-paper";

import { useProfile, useUser } from "@/core/supabase";
import {
  BlacklistSetting,
  DeleteSetting,
  DietarySetting,
  FeedbackSetting,
  LogoutSetting,
  PromptsSetting,
  SettingItem,
  ServingsSetting,
  SkillSetting,
  SubscriptionButton,
  UnitSetting,
} from "@/shared/settings";
import { useTheme } from "@/shared/theme";
import { Card, Divider, Row, ScrollView, Section } from "@/shared/ui";

const DefaultImage = require("@/core/assets/images/icon.png");

export const SettingsScreen = () => {
  const { colors } = useTheme();

  const user = useUser();

  const profile = useProfile();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Section title="Account">
        <Card style={styles.section}>
          <View style={styles.profileHeader}>
            <Avatar.Text
              size={40}
              label={user.data?.user_metadata?.email?.[0]?.toUpperCase() || "U"}
              style={{ backgroundColor: colors.primaryContainer }}
            />
            <View style={styles.profileInfo}>
              <Text variant="titleSmall" style={{ color: colors.onBackground }}>
                {profile.data?.display_name}
              </Text>
              <Text style={{ color: colors.onBackgroundVariant }}>Profile</Text>
            </View>
          </View>
          <Divider color={colors.outline} style={styles.divider} />
          <Row
            centered
            spacing={12}
            style={{
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: 16,
            }}
          >
            <Image
              source={{ uri: Image.resolveAssetSource(DefaultImage).uri }}
              style={styles.subscriptionImage}
            />
            <View>
              <Text style={{ color: colors.onBackgroundVariant }}>
                Subscription
              </Text>
              <Text style={{ color: colors.onSurface }} variant="titleSmall">
                FRIDGEEZY+
              </Text>
            </View>
            <SubscriptionButton />
          </Row>
        </Card>
      </Section>

      {/* Preferences Section */}
      <Section title="Preferences">
        <Card>
          <DietarySetting />
          <Divider color={colors.outline} style={styles.divider} />
          <BlacklistSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <ServingsSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <SkillSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <PromptsSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <UnitSetting />
        </Card>
      </Section>

      {/* Settings Section */}
      <Section title="Social">
        <Card>
          <SettingItem
            icon="share-variant"
            title="Recommend"
            onPress={() => {}}
          />
          <Divider color={colors.outline} style={styles.divider} />
          <FeedbackSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <LogoutSetting />
          <Divider color={colors.outline} style={styles.divider} />
          <DeleteSetting />
        </Card>
      </Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 40,
    marginHorizontal: 16,
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
  sectionTitle: { paddingHorizontal: 4 },
  subscriptionImage: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
});
