import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { IconButton, Text } from "react-native-paper";

import {
  useCollection,
  useCollectionRecipes,
  useDeleteCollectionRecipe,
  useInsertCollectionRecipe,
  useProfileRecipeInteractions,
} from "@/core/supabase";
import { useRecipes } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import {
  AnimatedPressable,
  Button,
  Card,
  Checkbox,
  Layout,
  Row,
  ScrollView,
  Section,
} from "@/shared/ui";

export const CollectionScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { colors } = useTheme();

  const navigation = useNavigation();

  const [isSelecting, setIsSelecting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const collection = useCollection(id);

  const collectionRecipes = useCollectionRecipes(id);

  const insertCollectionRecipe = useInsertCollectionRecipe();

  const deleteCollectionRecipe = useDeleteCollectionRecipe(id);

  const viewedInteractions = useProfileRecipeInteractions("viewed");

  const viewedRecipeIds =
    viewedInteractions.data?.map((item) => item.recipe_id) ?? [];

  const viewedRecipes = useRecipes(viewedRecipeIds);

  const existingRecipeIds =
    collectionRecipes.data?.map((item) => item.recipe_id) ?? [];

  const availableRecipes =
    viewedRecipes.data?.filter(
      (recipe) => !existingRecipeIds.includes(recipe.id),
    ) ?? [];

  const handleToggleSelect = (recipeId: string) => {
    setSelectedIds((prev) =>
      prev.includes(recipeId)
        ? prev.filter((id) => id !== recipeId)
        : [...prev, recipeId],
    );
  };

  const handleAddRecipes = async () => {
    if (!id || selectedIds.length === 0) return;

    await insertCollectionRecipe.mutateAsync(
      selectedIds.map((recipeId) => ({
        collection_id: id,
        recipe_id: recipeId,
      })),
    );

    setSelectedIds([]);
    setIsAdding(false);
  };

  const handleRemoveRecipes = async () => {
    if (selectedIds.length === 0) return;

    const idsToRemove = collectionRecipes.data
      ?.filter((item) => selectedIds.includes(item.recipe_id))
      .map((item) => item.id);

    if (idsToRemove?.length) {
      await deleteCollectionRecipe.mutateAsync(idsToRemove);
    }

    setSelectedIds([]);
    setIsSelecting(false);
  };

  const handleCancelSelect = () => {
    setSelectedIds([]);
    setIsSelecting(false);
    setIsAdding(false);
  };

  useEffect(() => {
    if (collection.data?.title) {
      navigation.setOptions({
        headerTitle: collection.data.title,
        headerRight: () => (
          <Row spacing={4}>
            {isSelecting || isAdding ? (
              <Button mode="text" compact onPress={handleCancelSelect}>
                Cancel
              </Button>
            ) : (
              <>
                <IconButton
                  icon="pencil"
                  size={20}
                  onPress={() => setIsSelecting(true)}
                  style={{ margin: 0 }}
                />
                <IconButton
                  icon="plus"
                  size={20}
                  onPress={() => setIsAdding(true)}
                  style={{ margin: 0 }}
                />
              </>
            )}
          </Row>
        ),
      });
    }
  }, [collection.data?.title, navigation, isSelecting, isAdding]);

  return (
    <Layout spacing={0}>
      <ScrollView contentContainerStyle={[styles.container, { marginTop: 40 }]}>
        {isAdding ? (
          <Section title="Add from History" style={{ marginHorizontal: 12 }}>
            {availableRecipes.length === 0 ? (
              <Card contentStyle={styles.emptyCard}>
                <Text
                  variant="bodyMedium"
                  style={{
                    color: colors.onSurfaceVariant,
                    textAlign: "center",
                  }}
                >
                  No recipes available to add
                </Text>
              </Card>
            ) : (
              <View style={styles.recipeList}>
                {availableRecipes.map((recipe) => (
                  <AnimatedPressable
                    key={recipe.id}
                    onPress={() => handleToggleSelect(recipe.id)}
                  >
                    <Card contentStyle={styles.recipeCard}>
                      <Row centered spacing={12}>
                        <Checkbox
                          checked={selectedIds.includes(recipe.id)}
                          onPress={() => handleToggleSelect(recipe.id)}
                        />
                        <Text
                          variant="titleSmall"
                          numberOfLines={1}
                          style={{ flex: 1, color: colors.onSurface }}
                        >
                          {recipe.name}
                        </Text>
                      </Row>
                    </Card>
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {selectedIds.length > 0 && (
              <Button
                mode="contained"
                onPress={handleAddRecipes}
                loading={insertCollectionRecipe.isPending}
                style={styles.actionButton}
              >
                Add {selectedIds.length} Recipe
                {selectedIds.length > 1 ? "s" : ""}
              </Button>
            )}
          </Section>
        ) : (
          <Section
            title={`${collectionRecipes.data?.length ?? 0} Recipes`}
            style={{ marginHorizontal: 16 }}
          >
            {(collectionRecipes.data?.length ?? 0) === 0 ? (
              <Card contentStyle={styles.emptyCard}>
                <Text
                  variant="bodyMedium"
                  style={{
                    color: colors.onSurfaceVariant,
                    textAlign: "center",
                  }}
                >
                  No recipes in this collection yet
                </Text>
                <Button
                  mode="text"
                  compact
                  onPress={() => setIsAdding(true)}
                  style={{ marginTop: 8 }}
                >
                  Add Recipes
                </Button>
              </Card>
            ) : (
              <View style={styles.recipeList}>
                {collectionRecipes.data?.map((item) => (
                  <AnimatedPressable
                    key={item.id}
                    onPress={
                      isSelecting
                        ? () => handleToggleSelect(item.recipe_id)
                        : undefined
                    }
                  >
                    <Card contentStyle={styles.recipeCard}>
                      <Row centered spacing={12}>
                        {isSelecting && (
                          <Checkbox
                            checked={selectedIds.includes(item.recipe_id)}
                            onPress={() => handleToggleSelect(item.recipe_id)}
                          />
                        )}
                        <Text
                          variant="titleSmall"
                          numberOfLines={1}
                          style={{ flex: 1, color: colors.onSurface }}
                        >
                          {item.recipe?.name ?? "Unknown Recipe"}
                        </Text>
                      </Row>
                    </Card>
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {isSelecting && selectedIds.length > 0 && (
              <Button
                mode="contained"
                onPress={handleRemoveRecipes}
                loading={deleteCollectionRecipe.isPending}
                style={styles.actionButton}
              >
                Remove {selectedIds.length} Recipe
                {selectedIds.length > 1 ? "s" : ""}
              </Button>
            )}
          </Section>
        )}
      </ScrollView>
    </Layout>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  recipeList: {
    gap: 8,
  },
  recipeCard: {
    padding: 20,
  },
  emptyCard: {
    padding: 24,
    alignItems: "center",
  },
  actionButton: {
    marginTop: 16,
  },
});
