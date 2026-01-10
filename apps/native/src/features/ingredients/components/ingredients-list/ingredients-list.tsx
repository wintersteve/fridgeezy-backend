import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Checkbox, Text } from "react-native-paper";

import {
  useDeletePantryItem,
  useInsertPantryItem,
  usePantryItems,
} from "@/core/supabase";
import { Ingredients } from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Card, Row, Skeleton } from "@/shared/ui";

export interface IngredientsListProps {
  data: Ingredients;
  base?: number;
  loading?: boolean;
  mode?: "flat" | "raised";
  target?: number;
  readonly?: boolean;
}

export const IngredientsList = (props: IngredientsListProps) => {
  const { base, data: injectedData, loading, readonly = false, target } = props;

  const data = injectedData ?? [];

  const { colors } = useTheme();

  const pantryItems = usePantryItems();
  const insertPantryItem = useInsertPantryItem();
  const deletePantryItem = useDeletePantryItem();

  const [checked, setChecked] = useState<Record<string, boolean>>(
    (pantryItems.data ?? []).reduce(
      (result, next) => ({ ...result, [next.ingredient_id]: true }),
      {},
    ),
  );

  const handlePress = (id: string) => {
    if ((pantryItems.data ?? []).some((item) => item.ingredient_id === id)) {
      deletePantryItem.mutate({ ingredient_id: id });
    } else {
      insertPantryItem.mutate({ ingredient_id: id });
    }

    setChecked((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <>
      {loading ? (
        <View style={{ gap: 12, marginTop: 8 }}>
          <Skeleton height={50} />
          <Skeleton height={50} />
          <Skeleton height={50} />
          <Skeleton height={50} />
          <Skeleton height={50} />
          <Skeleton height={50} />
        </View>
      ) : (
        <View>
          <View style={{ gap: 6 }}>
            {data?.map((ingredient) => (
              <Pressable
                key={ingredient.id}
                disabled={readonly}
                onPress={() => handlePress(ingredient.id)}
              >
                <Card contentStyle={{ padding: 12 }}>
                  <Row between centered>
                    <Row between centered>
                      <View style={{ marginRight: 2 }}>
                        <Checkbox.Android
                          color={colors.primary}
                          uncheckedColor={colors.onBackgroundVariant}
                          status={
                            checked[ingredient.id] ? "checked" : "unchecked"
                          }
                        />
                      </View>
                      <Text
                        variant="labelMedium"
                        style={[
                          !readonly &&
                            checked[ingredient.id] && {
                              ...styles.ingredientChecked,
                              color: colors.onSurfaceDisabled,
                            },
                        ]}
                      >
                        {titleCase(ingredient.ingredient?.name)}
                      </Text>
                    </Row>

                    <View style={{ marginRight: 8 }}>
                      {(ingredient.quantity ||
                        ingredient.unit?.abbreviation) && (
                        <Text
                          variant="bodyMedium"
                          style={[
                            { color: colors.onBackgroundVariant },
                            checked[ingredient.id] && {
                              ...styles.ingredientChecked,
                            },
                          ]}
                        >
                          {ingredient.quantity} {ingredient.unit?.abbreviation}
                        </Text>
                      )}
                    </View>
                  </Row>
                </Card>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  row: { borderBottomWidth: 8 },
  ingredientChecked: { textDecorationLine: "line-through" },
  count: {
    alignSelf: "flex-end",
    fontSize: 12,
    paddingTop: 12,
    color: "#888",
  },
});
