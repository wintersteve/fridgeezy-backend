import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Portal } from "react-native-paper";

import { PantryItemWithIngredient } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Chip, Row } from "@/shared/ui";

export interface PantrySelectProps {
  data: PantryItemWithIngredient[];
  onAddPress?: VoidFunction;
  onConfirmPress?: (ids: string[]) => void;
  onSelect?: (ids: string[]) => void;
}

export const PantrySelect = (props: PantrySelectProps) => {
  const { data, onAddPress, onConfirmPress, onSelect } = props;

  const { colors } = useTheme();

  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const toggleSelect = (ingredientId: string) => {
    const nextItems = selectedItems.includes(ingredientId)
      ? selectedItems.filter((id) => id !== ingredientId)
      : [...selectedItems, ingredientId];

    onSelect?.(nextItems);
    setSelectedItems(nextItems);
  };

  const confirmDelete = () => {
    onConfirmPress?.(selectedItems);
    setSelectedItems([]);
  };

  const cancelSelection = () => {
    setSelectedItems([]);
  };

  const isSelecting = selectedItems.length > 0;

  return (
    <>
      <Row spacing={4} style={{ flexWrap: "wrap" }}>
        {data
          .sort((a, b) =>
            (a.ingredient?.name ?? "").localeCompare(b.ingredient?.name ?? ""),
          )
          .map((item) => (
            <Chip
              key={item.id}
              selected={selectedItems.includes(item.ingredient_id)}
              onPress={() => toggleSelect(item.ingredient_id)}
            >
              {titleCase(item.ingredient?.name ?? "")}
            </Chip>
          ))}
        {onAddPress && <Chip onPress={onAddPress}>+</Chip>}
      </Row>

      {isSelecting && (
        <Portal>
          <View
            style={[styles.actions, { backgroundColor: colors.background }]}
          >
            <Button
              textColor={colors.onSurfaceVariant}
              onPress={cancelSelection}
            >
              Cancel
            </Button>
            <Button onPress={confirmDelete} textColor={colors.error}>
              Delete ({selectedItems.length})
            </Button>
          </View>
        </Portal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  actions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1E1E1E20",
    zIndex: 1,
  },
});
