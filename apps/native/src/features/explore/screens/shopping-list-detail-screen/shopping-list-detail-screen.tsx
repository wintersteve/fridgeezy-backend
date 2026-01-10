import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useDeleteShoppingList, usePantryItems } from "@/core/supabase";
import { IngredientsList } from "@/features/ingredients";
import { RecipeProgress } from "@/features/recipes/components/recipe-progress";
import { useRecipe } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import {
  Button,
  Card,
  ErrorBoundary,
  Link,
  Row,
  ScrollView,
} from "@/shared/ui";

export const ShoppingListDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();

  const { data: recipe, isLoading } = useRecipe(id);
  const pantryItems = usePantryItems();
  const deleteShoppingList = useDeleteShoppingList();

  const matchedIngredients =
    recipe?.ingredients.items.filter((ingredient) =>
      (pantryItems.data ?? []).some(
        (item) => item.ingredient_id === ingredient.id,
      ),
    ).length ?? 0;

  const handleDelete = () => {
    if (recipe?.id) {
      deleteShoppingList.mutate({ recipe_id: recipe.id });
      router.back();
    }
  };

  if (isLoading) {
    return null;
  }

  if (!recipe) {
    return <ErrorBoundary />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={{ color: colors.onSurface }}>
          {recipe.name}
        </Text>
        <RecipeProgress
          strokeColor={colors.surfaceVariant}
          value={matchedIngredients}
          total={recipe.ingredients.count}
        />
      </View>

      <Card contentStyle={styles.card}>
        <Text variant="titleMedium" style={{ marginBottom: 12 }}>
          Ingredients
        </Text>
        <IngredientsList data={recipe.ingredients} />
      </Card>

      <View style={styles.actions}>
        <Link href={`/recipes/${recipe.id}`} style={{ flex: 1 }}>
          <Button mode="contained" style={{ width: "100%" }}>
            View Recipe
          </Button>
        </Link>
      </View>

      <Row centered style={{ marginTop: 8 }}>
        <Button
          mode="text"
          textColor={colors.error}
          onPress={handleDelete}
          loading={deleteShoppingList.isPending}
        >
          Delete Shopping List
        </Button>
      </Row>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  card: {
    padding: 16,
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
});
