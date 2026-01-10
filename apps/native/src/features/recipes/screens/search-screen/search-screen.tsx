import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  IngredientsFilterModal,
  IngredientsFilterModalRef,
  useIngredientsFilterStore,
  useIngredientStore,
} from "@/features/ingredients";
import { RecipeCard, RecipeCardSkeleton } from "@/features/recipes";
import { Recipe } from "@/shared/entities";
import { useSuggestRecipe } from "@/shared/mcp";
import { useTheme } from "@/shared/theme";
import { ScrollView, Row, Card, Button } from "@/shared/ui";

import { RecipeFilters } from "../../components/recipe-filters";

import { SearchSummary } from "./search-summary";

export const SearchScreen = () => {
  const params = useLocalSearchParams<{ cuisine?: string }>();

  const { colors } = useTheme();

  const router = useRouter();

  const navigation = useNavigation();

  const filterModalRef = useRef<IngredientsFilterModalRef>(null);

  const insets = useSafeAreaInsets();

  const ingredientsStore = useIngredientStore();

  const filterStore = useIngredientsFilterStore();

  const filter = {
    blacklist: filterStore.blacklist,
    course: filterStore.course,
    cuisine: filterStore.cuisine,
    component: filterStore.component,
    difficulty: filterStore.difficulty,
    dietaryRestrictions: filterStore.restrictions,
    ingredients: ingredientsStore.ingredients?.map((item) => item.id),
  };

  const suggestRecipes = useSuggestRecipe(filter);

  const TOTAL_RECIPES = 5;

  const loadedCount = suggestRecipes.data?.length ?? 0;

  const skeletonCount = suggestRecipes.isLoading
    ? TOTAL_RECIPES - loadedCount
    : 0;

  const hasResults = suggestRecipes.data?.length > 0;

  const handleShowAllFilters = () => {
    filterModalRef.current?.open();
  };

  const handleIngredientsChange = (newIngredients: string[]) => {
    if (newIngredients.length === 0) {
      router.back();
      return;
    }
    const params = encodeURIComponent(newIngredients.join(","));
    router.setParams({ ingredients: params });
  };

  const handleSuggestionPress = (item: Recipe) => {
    router.push({
      pathname: `/recipes/generate`,
      params: {
        ingredients: item.ingredients,
        name: item.name,
        tags: item.tags,
      },
    });
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row>
          <IngredientsFilterModal />
        </Row>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (!!params?.cuisine) {
      filterStore.setCuisine(params.cuisine);
    }
  }, [params.cuisine]);

  return (
    <>
      <ScrollView>
        <View style={{ marginTop: 12, gap: 12 }}>
          <View style={{ gap: 12, paddingHorizontal: 16, marginBottom: 6 }}>
            <RecipeFilters
              disabled={suggestRecipes.isLoading}
              onShowAllFilters={handleShowAllFilters}
            />
          </View>
          <SearchSummary
            ingredients={ingredientsStore.ingredients?.map((item) => item.id)}
            onIngredientsChange={handleIngredientsChange}
          />
          {(suggestRecipes.isLoading || hasResults) && (
            <View style={{ gap: 8, marginHorizontal: 14 }}>
              {suggestRecipes.data?.map((item) => (
                <RecipeCard
                  fullWidth
                  key={item.title}
                  data={item}
                  onPress={() => handleSuggestionPress(item)}
                />
              ))}
              {Array.from({ length: skeletonCount }).map((_, index) => (
                <RecipeCardSkeleton key={`skeleton-${index}`} />
              ))}
            </View>
          )}
        </View>

        {!suggestRecipes.isLoading && !hasResults && (
          <>
            <View style={{ flexGrow: 1, marginHorizontal: 14, marginTop: 12 }}>
              <Card contentStyle={{ padding: 24 }}>
                <View style={{ gap: 4 }}>
                  <Icon color={colors.error} source="close-thick" size={32} />
                  <Text variant="headlineSmall">No results</Text>
                  <Text variant="bodySmall" style={{ marginRight: 40 }}>
                    We couldn&apos;t find any recipes. Try adjusting your
                    ingredients
                  </Text>
                </View>
              </Card>
            </View>
          </>
        )}
        <IngredientsFilterModal ref={filterModalRef} hideTrigger />
      </ScrollView>
      <Button
        icon="chevron-left"
        onPress={() => router.back()}
        style={{ marginHorizontal: 14, marginBottom: 40, marginTop: "auto" }}
      >
        Back
      </Button>
    </>
  );
};
