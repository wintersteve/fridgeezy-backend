import { useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  View,
} from "react-native";
import { Icon, Text } from "react-native-paper";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

import { MealTimeCard } from "@/features/home/components/suggest-tab/components/meal-time-card";
import { RecipeCards } from "@/features/recipes";
import { usePopularRecipes } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import {
  AnimatedPressable,
  Card,
  Chip,
  Link,
  Row,
  ScrollView,
  Section,
} from "@/shared/ui";

import { TOP_CUISINES } from "../../constants";

const RecipeImage = require("@/core/assets/recipe.jpg");

export interface HomeTabContent {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

const MEAL_TIMES = [
  { id: "breakfast", icon: "weather-sunset-up", title: "Breakfast" },
  { id: "lunch", icon: "white-balance-sunny", title: "Lunch" },
  { id: "dinner", icon: "weather-night", title: "Dinner" },
  { id: "snack", icon: "cookie", title: "Snack" },
];

const getCurrentMealTime = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 18) return "snack";
  return "dinner";
};

export const HomeTab = (props: HomeTabContent) => {
  const { onScroll } = props;

  const { colors } = useTheme();

  const router = useRouter();

  const [, requestPermission] = useCameraPermissions();

  const { data, isLoading } = usePopularRecipes();

  const currentMealTime = useMemo(() => getCurrentMealTime(), []);

  const handleMealTimePress = (mealId: string) => {
    switch (mealId) {
      case "breakfast":
        router.push("/recipes/search?ingredients=eggs,toast,oatmeal");
        break;
      case "lunch":
        router.push("/recipes/search?ingredients=sandwich,salad,soup");
        break;
      case "dinner":
        router.push("/recipes/search?ingredients=chicken,rice,vegetables");
        break;
      case "snack":
        router.push("/recipes/search?ingredients=nuts,fruit,yogurt");
        break;
    }
  };

  const handleTakePicture = async () => {
    const response = await requestPermission();

    if (response.granted) {
      router.push("/camera");
    }
  };

  const handlePantryPress = () => {
    router.push("/ingredients");
  };

  return (
    <>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16}>
        <Animated.View entering={FadeInUp.delay(50).duration(400).springify()}>
          <ScrollView
            horizontal
            contentContainerStyle={{ paddingHorizontal: 8 }}
            style={{ marginBottom: 6, marginTop: 8 }}
          >
            <Row spacing={6}>
              {MEAL_TIMES.map((meal) => (
                <MealTimeCard
                  key={meal.id}
                  icon={meal.icon}
                  title={meal.title}
                  isActive={meal.id === currentMealTime}
                  onPress={() => handleMealTimePress(meal.id)}
                />
              ))}
            </Row>
          </ScrollView>
        </Animated.View>

        {/* Hero Card: Snap Your Ingredients */}
        <Animated.View entering={FadeInUp.delay(100).duration(400).springify()}>
          <AnimatedPressable onPress={handleTakePicture}>
            <Card mode="contained" style={styles.heroCard}>
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                colors={[colors.primary, "#f6a171"]}
                style={styles.heroGradient}
              >
                <Image
                  source={RecipeImage}
                  style={styles.recipeImage}
                  resizeMode="cover"
                />
                <Row between>
                  <View style={{ gap: 10 }}>
                    <Icon
                      color={colors.surfaceVariant}
                      source="image-plus"
                      size={32}
                    />
                    <View>
                      <Text
                        variant="headlineSmall"
                        style={{ color: colors.surfaceVariant, left: -1 }}
                      >
                        Snap Ingredients
                      </Text>
                      <Text
                        style={{
                          color: colors.surfaceVariant,
                          marginRight: "40%",
                        }}
                        variant="bodySmall"
                      >
                        One photo, endless recipe ideas
                      </Text>
                    </View>
                  </View>
                  <View style={{ position: "absolute", right: 0 }}>
                    <Icon
                      color="rgba(255,255,255,0.7)"
                      source="chevron-right"
                      size={32}
                    />
                  </View>
                </Row>
              </LinearGradient>
            </Card>
          </AnimatedPressable>
        </Animated.View>

        {/* Hero Card: Browse Your Pantry */}
        <Animated.View entering={FadeInUp.delay(150).duration(400).springify()}>
          <AnimatedPressable onPress={handlePantryPress}>
            <View style={{ overflow: "hidden" }}>
              <Image
                source={{
                  uri: "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/category_images/herb.png",
                }}
                style={[
                  styles.recipeImage,
                  {
                    height: 80,
                    width: 80,
                    right: null,
                    top: 4,
                    left: 8,
                    zIndex: 1,
                  },
                ]}
                resizeMode="cover"
              />
              <Image
                source={{
                  uri: "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/category_images/cheese.png",
                }}
                style={[
                  styles.recipeImage,
                  { right: null, top: 50, left: 30, zIndex: 1, opacity: 0.5 },
                ]}
                resizeMode="cover"
              />
              <Card contentStyle={{ padding: 24 }} style={styles.pantryCard}>
                <View style={{ gap: 10, alignItems: "flex-end" }}>
                  <Icon
                    color={colors.primary}
                    source="basket-check"
                    size={32}
                  />
                  <View>
                    <Text
                      variant="headlineSmall"
                      style={{ textAlign: "right" }}
                    >
                      Browse Pantry
                    </Text>
                    <Text
                      style={{
                        color: colors.onSurfaceVariant,
                        marginLeft: "40%",
                        textAlign: "right",
                      }}
                      variant="bodySmall"
                    >
                      Cook with what you already have
                    </Text>
                  </View>
                </View>
              </Card>
            </View>
          </AnimatedPressable>
        </Animated.View>

        {/* Popular Recipes Section */}
        <Animated.View entering={FadeInUp.delay(250).duration(400).springify()}>
          <Section
            title="Popular"
            style={{ marginHorizontal: 16, marginBottom: 12 }}
          >
            <RecipeCards
              horizontal
              data={(data as any) ?? []}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              style={{ marginHorizontal: -16 }}
              isLoading={isLoading}
            />
          </Section>
        </Animated.View>

        {/* Top Cuisines Section */}
        <Animated.View entering={FadeInUp.delay(350).duration(400).springify()}>
          <Section title="Top Cuisines" style={{ marginHorizontal: 16 }}>
            <Row spacing={6}>
              {TOP_CUISINES.map((cuisine, index) => (
                <Animated.View
                  key={cuisine.name}
                  entering={FadeInDown.delay(400 + index * 80)
                    .duration(350)
                    .springify()}
                  style={{ flexBasis: "30%", flexGrow: 1 }}
                >
                  <AnimatedPressable>
                    <Card style={styles.cuisineCard}>
                      <Link href={`/recipes/search?cuisine=${cuisine.name}`}>
                        <View
                          style={{
                            alignItems: "center",
                            paddingVertical: 14,
                            gap: 8,
                          }}
                        >
                          <View style={styles.cuisineImageWrapper}>
                            <Image
                              source={{
                                uri: `https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/cuisine_images/${cuisine.name.toLowerCase()}.png`,
                              }}
                              style={[
                                styles.cuisineImage,
                                { borderColor: colors.primaryContainer },
                              ]}
                            />
                          </View>
                          <Chip>{titleCase(cuisine.name)}</Chip>
                        </View>
                      </Link>
                    </Card>
                  </AnimatedPressable>
                </Animated.View>
              ))}
            </Row>
          </Section>
        </Animated.View>
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  heroCard: {
    marginHorizontal: 12,
    marginTop: 6,
  },
  heroGradient: {
    borderRadius: 12,
    padding: 24,
    overflow: "hidden",
  },
  recipeImage: {
    position: "absolute",
    bottom: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    opacity: 0.75,
  },
  decorCircleLarge: {
    position: "absolute",
    right: -30,
    top: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  decorCircleSmall: {
    position: "absolute",
    right: 50,
    bottom: -15,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  pantryCard: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 20,
    borderRadius: 12,
  },
  sectionAccent: {
    width: 4,
    height: 16,
    borderRadius: 4,
  },
  cuisineCard: {
    shadowColor: "#F4A67A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cuisineImageWrapper: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cuisineImage: {
    borderRadius: 100,
    borderWidth: 4,
    height: 74,
    width: 74,
  },
  cuisineLabel: {
    textAlign: "center",
    marginTop: 10,
    fontWeight: "600",
  },
});
