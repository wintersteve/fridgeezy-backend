import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { usePantryItems, useShoppingLists } from "@/core/supabase";
import { ShoppingListCard } from "@/features/explore/components/shopping-list-card";
import { IngredientsList } from "@/features/ingredients";
import { Recipe } from "@/shared/entities";
import { useRecipes } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { BottomSheet, Card, EmptyCard, Row, Skeleton } from "@/shared/ui";

export const ShoppingLists = () => {
  const shoppingLists = useShoppingLists();

  const recipeIds = shoppingLists.data?.map((s) => s.recipe_id) ?? [];

  const [id, setId] = useState<string>("");

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  const recipes = useRecipes(recipeIds);

  const recipe = recipes.data?.find((item) => item.id === id);

  const { colors } = useTheme();

  const pantryItems = usePantryItems();

  const findIngredients = (list: Recipe) => {
    return (
      list.ingredients.items?.filter((ingredient) =>
        (pantryItems.data ?? []).some(
          (item) => item.ingredient_id === ingredient.id,
        ),
      ).length ?? 0
    );
  };

  const handlePress = (id: string) => {
    setId(id);
    bottomSheetModalRef.current?.present();
  };

  if (shoppingLists.isLoading || recipes.isLoading) {
    return (
      <View style={{ gap: 6 }}>
        {[1, 2, 3].map((index) => (
          <Card key={index} contentStyle={{ padding: 20 }}>
            <View style={{ gap: 8 }}>
              <Skeleton borderRadius={100} height={34} width={34} />
              <View style={{ gap: 6 }}>
                <Skeleton borderRadius={2} height={16} width={80} />
                <Skeleton borderRadius={2} height={10} width={120} />
              </View>
            </View>
          </Card>
        ))}
      </View>
    );
  }

  if (!recipes.data || recipes.data.length === 0) {
    return (
      <EmptyCard description="No shopping lists found. Visit a recipe and add it to create a shopping list." />
    );
  }

  return (
    <View>
      {recipes.data.map((recipe) => (
        <View key={recipe.id}>
          <ShoppingListCard data={recipe} onPress={handlePress} />
        </View>
      ))}
      <BottomSheet ref={bottomSheetModalRef} snapPoints={["70%"]}>
        <View style={{ paddingHorizontal: 12 }}>
          <Row centered>
            <Text
              variant="headlineMedium"
              style={{ alignSelf: "center", marginBottom: 24 }}
            >
              {recipe?.name}
            </Text>
          </Row>
          <IngredientsList data={recipe?.ingredients ?? []} />
        </View>
      </BottomSheet>
    </View>
  );
};
