import { useRouter } from "expo-router";
import { TouchableOpacity, View, StyleSheet } from "react-native";
import { Icon, Text } from "react-native-paper";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

type TabId = "Ingredients" | "Steps";

export interface RecipeHeaderProps {
  title: string;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  scrollY: SharedValue<number>;
  headerRight?: React.ReactNode;
}

export const RecipeHeader = ({
  title,
  activeTab,
  onTabChange,
  scrollY,
  headerRight,
}: RecipeHeaderProps) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const largeTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, 50],
      [1, 0],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollY.value,
      [0, 50],
      [0, -10],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const smallTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [30, 60],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      {/* Top row with back button, small title, and actions */}
      <View style={styles.topRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Icon source="chevron-left" size={28} color={colors.onSurface} />
        </TouchableOpacity>

        <Animated.View style={[styles.smallTitleContainer, smallTitleStyle]}>
          <Text
            variant="titleMedium"
            numberOfLines={1}
            style={{ color: colors.onSurface }}
          >
            {title}
          </Text>
        </Animated.View>

        <View style={styles.headerRight}>{headerRight}</View>
      </View>

      {/* Large title */}
      <Animated.View style={[styles.largeTitleContainer, largeTitleStyle]}>
        <Text variant="headlineLarge" style={{ color: colors.onSurface }}>
          {title}
        </Text>
      </Animated.View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <Row
          spacing={0}
          wrap={false}
          style={[
            styles.tabContainer,
            { backgroundColor: colors.backgroundVariant },
          ]}
        >
          {(["Details", "Ingredients", "Steps"] as TabId[]).map((tabId) => (
            <TouchableOpacity
              key={tabId}
              style={[
                styles.tab,
                {
                  backgroundColor:
                    tabId === activeTab ? colors.background : "transparent",
                },
              ]}
              onPress={() => onTabChange(tabId)}
            >
              <Text
                variant="labelMedium"
                style={{
                  color:
                    tabId === activeTab
                      ? colors.primary
                      : colors.onSurfaceVariant,
                }}
              >
                {tabId}
              </Text>
            </TouchableOpacity>
          ))}
        </Row>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 8,
  },
  backButton: {
    padding: 8,
  },
  smallTitleContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  headerRight: {
    minWidth: 44,
    alignItems: "flex-end",
  },
  largeTitleContainer: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  tabBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tabContainer: {
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
});
