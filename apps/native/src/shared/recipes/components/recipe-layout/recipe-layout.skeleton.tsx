import { View } from "react-native";
import { Icon } from "react-native-paper";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme";
import { Card, Row, Skeleton } from "@/shared/ui";

import {
  RECIPE_LAYOUT_IMAGE_HEIGHT,
  RECIPE_LAYOUT_STYLES,
} from "./recipe-layout.styles";

export const RecipeLayoutSkeleton = () => {
  const { colors } = useTheme();

  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <View style={[RECIPE_LAYOUT_STYLES.HEADER_OVERLAY]}>
        <View style={RECIPE_LAYOUT_STYLES.HEADER_CONTENT}>
          <View
            style={[
              RECIPE_LAYOUT_STYLES.BACK_BUTTON,
              {
                marginTop: insets.top,
                backgroundColor: colors.secondaryContainer,
                borderColor: colors.secondary,
              },
            ]}
          >
            <Icon source="chevron-left" size={28} color={colors.secondary} />
          </View>
          <View style={[RECIPE_LAYOUT_STYLES.HEADER_TITLE_CONTAINER]}>
            <Skeleton height={24} width="80%" style={{ alignSelf: "center" }} />
          </View>
          <View style={{ width: 44, height: 44 }} />
        </View>
      </View>

      <Animated.ScrollView
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Image Skeleton */}
        <View style={RECIPE_LAYOUT_STYLES.IMAGE_WRAPPER}>
          <Skeleton
            height={RECIPE_LAYOUT_IMAGE_HEIGHT}
            width="100%"
            borderRadius={0}
          />
        </View>

        {/* Card Overlay */}
        <View
          style={[
            RECIPE_LAYOUT_STYLES.CARD_OVERLAY,
            { backgroundColor: colors.background },
          ]}
        >
          {/* Title Skeleton */}
          <Skeleton
            height={28}
            width="40%"
            style={{ alignSelf: "center", marginBottom: 4 }}
          />

          {/* Tags Skeleton */}
          <Row spacing={6} style={RECIPE_LAYOUT_STYLES.TAGS_CONTAINER}>
            <Skeleton height={32} width={70} />
            <Skeleton height={32} width={60} />
            <Skeleton height={32} width={80} />
            <Skeleton height={32} width={32} />
          </Row>

          {/* Description Skeleton */}
          <Card
            contentStyle={{ padding: 20 }}
            style={{ marginHorizontal: 20, marginBottom: 12 }}
          >
            <Skeleton height={120} width="100%" style={{ marginBottom: 4 }} />
          </Card>

          {/* Info Cards Skeleton */}
          <Row
            spacing={12}
            style={{ justifyContent: "center", marginBottom: 16 }}
          >
            <Skeleton height={80} width={110} />
            <Skeleton height={80} width={110} />
            <Skeleton height={80} width={110} />
          </Row>

          {/* Nutrients Skeleton */}
          <View style={{ alignSelf: "center", marginBottom: 12 }}>
            <Skeleton height={40} width={200} />
          </View>

          {/* Ingredients Section Skeleton */}
          <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
            <Skeleton height={24} width={150} style={{ marginBottom: 16 }} />
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={{ marginBottom: 12 }}>
                <Skeleton height={60} width="100%" />
              </View>
            ))}
          </View>

          {/* Steps Section Skeleton */}
          <View style={{ paddingTop: 32, paddingHorizontal: 20 }}>
            <Skeleton height={24} width={150} style={{ marginBottom: 16 }} />
            {[1, 2, 3].map((i) => (
              <View key={i} style={{ marginBottom: 12 }}>
                <Skeleton height={80} width="100%" />
              </View>
            ))}
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  );
};
