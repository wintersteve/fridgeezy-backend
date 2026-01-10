import { Text } from "react-native-paper";
import Animated, { FadeInUp } from "react-native-reanimated";

import { useProfileRecipeInteractions } from "@/core/supabase";
import { RecipeCards } from "@/features/recipes";
import { useRecipes } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { EmptyCard, ScrollView, Section } from "@/shared/ui";

import { CollectionsSection } from "./components/collections-section";
import { CookingStatsCard } from "./components/cooking-stats-card";

export const SavedTab = () => {
  const { colors } = useTheme();

  const favorites = useProfileRecipeInteractions("favourite");
  const cooked = useProfileRecipeInteractions("cooked");
  const viewed = useProfileRecipeInteractions("viewed");

  const favoriteIds = favorites.data?.map((item) => item.recipe_id) ?? [];
  const cookedIds = cooked.data?.map((item) => item.recipe_id) ?? [];
  const viewedIds = viewed.data?.map((item) => item.recipe_id) ?? [];

  const favoriteRecipes = useRecipes(favoriteIds);
  const cookedRecipes = useRecipes(cookedIds);
  const viewedRecipes = useRecipes(viewedIds);

  return (
    <ScrollView>
      <Animated.View entering={FadeInUp.delay(50).duration(400).springify()}>
        <CookingStatsCard />
      </Animated.View>

      {/* Collections Section */}
      <Animated.View entering={FadeInUp.delay(450).duration(400).springify()}>
        <CollectionsSection />
      </Animated.View>

      {/* Favourites Section */}
      <Animated.View entering={FadeInUp.delay(150).duration(400).springify()}>
        <Section
          title={
            <Text
              variant="headlineSmall"
              style={{ color: colors.onBackgroundVariant }}
            >
              Favourites
            </Text>
          }
          style={{ marginHorizontal: 16 }}
        >
          {favoriteIds.length === 0 ? (
            <EmptyCard
              icon="heart-outline"
              title="No favourites yet"
              description="Tap the heart icon on any recipe to save it here"
            />
          ) : (
            <RecipeCards
              horizontal
              contentContainerStyle={{ paddingBottom: 12 }}
              data={(favoriteRecipes.data as any) ?? []}
              isLoading={favoriteRecipes.isLoading}
            />
          )}
        </Section>
      </Animated.View>

      {/* Cooked Section */}
      <Animated.View entering={FadeInUp.delay(250).duration(400).springify()}>
        <Section
          title={
            <Text
              variant="headlineSmall"
              style={{ color: colors.onBackgroundVariant }}
            >
              Cooked
            </Text>
          }
          titleStyle={{ paddingHorizontal: 18 }}
          style={{ marginTop: 12 }}
        >
          {cookedIds.length === 0 ? (
            <EmptyCard
              icon="card-minus"
              title="Nothing cooked yet"
              description="Mark recipes as cooked to track your culinary adventures"
              style={{ marginHorizontal: 16 }}
            />
          ) : (
            <RecipeCards
              horizontal
              contentContainerStyle={{
                paddingBottom: 12,
                paddingHorizontal: 16,
              }}
              data={(cookedRecipes.data as any) ?? []}
              isLoading={cookedRecipes.isLoading}
            />
          )}
        </Section>
      </Animated.View>

      {/* Recently Viewed Section */}
      <Animated.View entering={FadeInUp.delay(350).duration(400).springify()}>
        <Section
          title={
            <Text
              variant="headlineSmall"
              style={{ color: colors.onBackgroundVariant }}
            >
              Recently Viewed
            </Text>
          }
          titleStyle={{ paddingHorizontal: 18 }}
          style={{ marginTop: 12 }}
        >
          {viewedIds.length === 0 ? (
            <EmptyCard
              icon="history"
              title="No history yet"
              description="Recipes you view will appear here"
              style={{ marginHorizontal: 16 }}
            />
          ) : (
            <RecipeCards
              horizontal
              contentContainerStyle={{
                paddingBottom: 12,
                paddingHorizontal: 16,
              }}
              data={(viewedRecipes.data as any) ?? []}
              isLoading={viewedRecipes.isLoading}
            />
          )}
        </Section>
      </Animated.View>
    </ScrollView>
  );
};
