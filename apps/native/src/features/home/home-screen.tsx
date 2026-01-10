import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Platform, UIManager, useWindowDimensions, View } from "react-native";
import { Text } from "react-native-paper";
import { TabView } from "react-native-tab-view";

import {
  useProfile,
  useProfileDietaryPreferences,
  useProfileSettings,
} from "@/core/supabase";
import {
  useIngredientsFilterStore,
  useIngredientStore,
} from "@/features/ingredients";
import { SearchAutocomplete } from "@/features/recipes";
import { useTestNotification } from "@/shared/notifications";
import { useTheme } from "@/shared/theme";
import { Divider, Layout, Row } from "@/shared/ui";

import { HomeTabBar } from "./components/home-tab-bar";
import { Scene } from "./components/scene";
import { TABS } from "./constants";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const HomeScreen = () => {
  const [index, setIndex] = useState(0);

  const profile = useProfile();

  const { colors } = useTheme();

  const layout = useWindowDimensions();

  const filterStore = useIngredientsFilterStore();

  const profileSettings = useProfileSettings();

  const preferences = useProfileDietaryPreferences();

  useTestNotification();

  const { resetSessionFilters } = useIngredientsFilterStore();

  const ingredientStore = useIngredientStore();

  useFocusEffect(
    useCallback(() => {
      resetSessionFilters();
      ingredientStore.clear();
      filterStore.initializeFromDB({
        settings: profileSettings?.data,
        restrictions: preferences.data?.map((item) => item.tag.name) ?? [],
      });
    }, [profileSettings.data, preferences.data]),
  );

  return (
    <Layout contentInsetAdjustmentBehavior="never" spacing={0}>
      <View style={{ flex: 1 }}>
        <View
          style={{
            backgroundColor: colors.surface,
            zIndex: 1,
          }}
        >
          <Row
            wrap={false}
            style={{ marginHorizontal: 18, marginBottom: 8, marginTop: 12 }}
          >
            <View style={{ flexShrink: 1, gap: 2 }}>
              <Row centered spacing={2}>
                <Text
                  variant="titleSmall"
                  style={{ color: colors.onBackgroundVariant, marginLeft: 2 }}
                >
                  Hi, {profile.data?.display_name}
                </Text>
              </Row>
              <Text variant="headlineLarge" style={{ marginRight: 60 }}>
                What are you cooking today?
              </Text>
            </View>
            <View style={{ marginTop: 0 }}>
              <SearchAutocomplete />
            </View>
          </Row>
          <View
            style={{
              borderBottomWidth: 1,
              borderColor: colors.outline,
              paddingBottom: 12,
            }}
          >
            <HomeTabBar index={index} onChange={setIndex} />
            <Divider
              color={colors.outline}
              height={3}
              width={40}
              style={{ alignSelf: "center" }}
            />
          </View>
        </View>

        <TabView
          navigationState={{ index, routes: TABS }}
          renderScene={Scene}
          onIndexChange={setIndex}
          initialLayout={{ width: layout.width }}
          swipeEnabled={false}
          renderTabBar={() => null}
        />
      </View>
      {/*<Fab />*/}
    </Layout>
  );
};
