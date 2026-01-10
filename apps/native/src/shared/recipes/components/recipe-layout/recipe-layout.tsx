import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, TouchableOpacity, View } from "react-native";
import { Icon, Text } from "react-native-paper";
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InfoCard } from "@/shared/recipes";
import { IngredientsSection } from "@/shared/recipes/components/ingredients-section";
import { RecipeData } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Button, Card, ErrorBoundary, Row } from "@/shared/ui";

import { ActionBar } from "../../components/action-bar";
import { CookedButton } from "../../components/cooked-button";
import { NutrientsSection } from "../../components/nutrients-section";
import { StepsModal } from "../../components/steps-modal";
import { TagsBottomSheet } from "../../components/tags-bottom-sheet";
import { TipsSection } from "../../components/tips-section";

import { RecipeLayoutSkeleton } from "./recipe-layout.skeleton";
import { RECIPE_LAYOUT_STYLES } from "./recipe-layout.styles";

const DefaultImage = require("@/core/assets/recipe.jpg");

const IMAGE_HEIGHT = 460;
const PARALLAX_FACTOR = 0.5;
const HEADER_FADE_START = 200;
const HEADER_FADE_END = 350;

export interface RecipeLayoutProps {
  data?: RecipeData;
  isLoading: boolean;
}

export const RecipeLayout = (props: RecipeLayoutProps) => {
  const { data, isLoading } = props;

  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [stepsModalVisible, setStepsModalVisible] = useState(false);

  const { colors } = useTheme();

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const difficultyIcon = {
    easy: "speedometer-slow",
    medium: "speedometer-medium",
    hard: "speedometer",
  };

  const imageAnimatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [-IMAGE_HEIGHT, 0, IMAGE_HEIGHT],
      [-IMAGE_HEIGHT * PARALLAX_FACTOR, 0, IMAGE_HEIGHT * PARALLAX_FACTOR],
    );
    const scale = interpolate(
      scrollY.value,
      [-IMAGE_HEIGHT, 0],
      [2, 1],
      "clamp",
    );
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  const headerBackgroundStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [HEADER_FADE_START, HEADER_FADE_END],
      [0, 1],
      "clamp",
    );
    return { opacity };
  });

  if (isLoading) {
    return <RecipeLayoutSkeleton />;
  }

  if (!data) return <ErrorBoundary />;

  const totalTime =
    parseInt(data?.cookTime ?? "0") + parseInt(data?.prepTime ?? "0");

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          RECIPE_LAYOUT_STYLES.HEADER_OVERLAY,
          { paddingTop: insets.top },
        ]}
      >
        <Animated.View
          style={[
            RECIPE_LAYOUT_STYLES.HEADER_BACKGROUND,
            { backgroundColor: colors.background },
            headerBackgroundStyle,
          ]}
        />
        <View style={RECIPE_LAYOUT_STYLES.HEADER_CONTENT}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[
              RECIPE_LAYOUT_STYLES.BACK_BUTTON,
              {
                backgroundColor: colors.secondaryContainer,
                borderColor: colors.secondary,
              },
            ]}
          >
            <Icon source="chevron-left" size={28} color={colors.secondary} />
          </TouchableOpacity>

          <ActionBar data={data as any} />
        </View>
      </View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Parallax Image */}
        <View style={RECIPE_LAYOUT_STYLES.IMAGE_WRAPPER}>
          <Animated.Image
            source={{ uri: Image.resolveAssetSource(DefaultImage)?.uri }}
            style={[RECIPE_LAYOUT_STYLES.HERO_IMAGE, imageAnimatedStyle]}
          />
          <View style={{ position: "absolute", bottom: 40, right: 20 }}>
            <Button
              icon="text"
              size="sm"
              style={{ borderRadius: 100 }}
              onPress={() => setStepsModalVisible(true)}
            >
              Instructions
            </Button>
          </View>
        </View>

        {/* Card Overlay */}
        <View
          style={[
            RECIPE_LAYOUT_STYLES.CARD_OVERLAY,
            { backgroundColor: colors.background },
          ]}
        >
          {/* Title */}
          <Text
            variant="titleLarge"
            style={[RECIPE_LAYOUT_STYLES.TITLE, { color: colors.onSurface }]}
          >
            {data.name}
          </Text>

          {/* Tags */}
          <TagsBottomSheet
            data={data}
            style={RECIPE_LAYOUT_STYLES.TAGS_CONTAINER}
          />

          {/* Description */}
          {data.description && (
            <Card
              contentStyle={{ padding: 20 }}
              style={{ marginHorizontal: 20, marginBottom: 12 }}
            >
              <Text
                variant="bodyMedium"
                style={[{ color: colors.onSurfaceVariant }]}
              >
                {data.description}
              </Text>
            </Card>
          )}

          {/* Info Cards */}
          <Row
            spacing={12}
            style={{ justifyContent: "center", marginBottom: 16 }}
          >
            <InfoCard
              icon="clock-outline"
              label="Total Time"
              value={`${totalTime} min`}
              colors={colors}
            />
            <InfoCard
              icon="fire"
              label="Serving"
              value={`524 kcal`}
              colors={colors}
            />
            <InfoCard
              icon={difficultyIcon?.[data.difficulty ?? "medium"]}
              label="Difficulty"
              value={titleCase(data.difficulty ?? "easy")}
              colors={colors}
            />
          </Row>

          <View style={{ alignSelf: "center", marginBottom: 12 }}>
            <NutrientsSection />
          </View>

          <View style={{ paddingTop: 20 }}>
            <IngredientsSection data={data as any} />
          </View>

          <View style={{ paddingTop: 32 }}>
            {/*<StepsSection data={data as any} />*/}
            <TipsSection data={data} />
            <View style={{ marginHorizontal: 20, marginTop: 12 }}>
              <CookedButton data={data} />
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      <StepsModal
        data={data}
        visible={stepsModalVisible}
        onDismiss={() => setStepsModalVisible(false)}
      />
    </View>
  );
};
