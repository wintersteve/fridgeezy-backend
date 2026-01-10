import { useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePantryItems } from "@/core/supabase";
import { PantryAutocomplete } from "@/features/pantry";
import { IngredientAccordions } from "@/shared/domain/ingredients/components/ingredient-accordions";
import { useFilteredCategories, useIngredients } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import {
  Button,
  EmptyCard,
  Row,
  ScrollView,
  Section,
  TextInput,
} from "@/shared/ui";

import { IngredientsFilterModal } from "../../components/ingredients-filter-modal";
import { useFilters } from "../../hooks/use-filters";
import { useIngredientStore } from "../../hooks/use-ingredients-store";

export const IngredientsScreen = () => {
  const { add, ingredients, remove } = useIngredientStore();

  const insets = useSafeAreaInsets();

  const router = useRouter();

  const navigation = useNavigation();

  const filters = useFilters();

  const pantryItems = usePantryItems();

  const allIngredients = useIngredients();

  const isMax = ingredients.length >= 5;

  const { colors } = useTheme();

  const [searchQuery, setSearchQuery] = useState("");

  // Set of ingredient IDs that are in the user's pantry
  const pantryIds = useMemo(
    () => new Set((pantryItems.data ?? []).map((item) => item.ingredient_id)),
    [pantryItems.data],
  );

  // Get filtered categories for pantry items
  const filteredCategories = useFilteredCategories(
    (id) => pantryIds.has(id),
    searchQuery,
  );

  // Map ingredient IDs to their names for selection
  const ingredientIdToName = useMemo(() => {
    const map = new Map<string, string>();
    (allIngredients.data ?? []).forEach((ing) => {
      map.set(ing.id, ing.name.toUpperCase());
    });
    return map;
  }, [allIngredients.data]);

  // Currently selected ingredient IDs (convert from names back to IDs)
  const selectedIds = useMemo(() => {
    const nameToId = new Map<string, string>();
    (allIngredients.data ?? []).forEach((ing) => {
      nameToId.set(ing.name.toUpperCase(), ing.id);
    });
    return ingredients
      .map((ing) => nameToId.get(ing.id))
      .filter(Boolean) as string[];
  }, [ingredients, allIngredients.data]);

  const handleSearchPress = async () => {
    router.push({
      pathname: `/recipes/search`,
      params: {
        ingredients: ingredients.map((ingredient) => ingredient.id),
      },
    });
  };

  const handleSelect = (id: string) => {
    const ingredientName = ingredientIdToName.get(id);

    if (!ingredientName) return;

    const found = ingredients.find((i) => i.id === ingredientName);

    if (found) {
      remove(ingredientName);
    } else {
      add({ id: ingredientName });
    }
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row>
          <PantryAutocomplete />
          <IngredientsFilterModal />
        </Row>
      ),
    });
  }, [navigation]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 12 }}
      >
        <Section title="Your Items">
          {pantryIds.size === 0 ? (
            <EmptyCard
              leftAligned
              title="Empty"
              description="Your pantry is empty. Add ingredients to get started."
            />
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ marginHorizontal: 4 }}>
                <TextInput
                  icon="magnify"
                  label="Search ingredients..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              <IngredientAccordions
                {...filteredCategories}
                selectedIds={selectedIds}
                onSelect={handleSelect}
              />
            </View>
          )}
          {isMax && (
            <Row
              centered
              spacing={6}
              style={{ marginTop: 12, marginHorizontal: 2 }}
            >
              <Icon
                color={colors.onSurfaceVariant}
                source="information-outline"
                size={24}
              />
              <Text
                variant="labelSmall"
                style={{ color: colors.onSurfaceVariant }}
              >
                You can only select up to 5 ingredients
              </Text>
            </Row>
          )}
        </Section>
      </ScrollView>
      <Button
        disabled={!ingredients.length}
        onPress={handleSearchPress}
        style={{ marginBottom: insets.bottom, marginHorizontal: 12 }}
      >
        Search
      </Button>
    </View>
  );
};
