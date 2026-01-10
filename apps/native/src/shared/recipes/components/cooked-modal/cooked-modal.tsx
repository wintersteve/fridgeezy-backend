import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import {
  useDeletePantryItem,
  useDeleteProfileRecipeInteraction,
  usePantryItems,
} from "@/core/supabase";
import { PantrySelect } from "@/features/pantry";
import { Recipe } from "@/shared/entities";
import { Modal, ModalProps } from "@/shared/ui";

export interface CookedModalProps extends ModalProps {
  recipe: Recipe;
}

export const CookedModal = (props: CookedModalProps) => {
  const { recipe, visible, onDismiss, ...rest } = props;

  const { ingredients } = recipe;

  const deleteInteraction = useDeleteProfileRecipeInteraction();
  const pantryItems = usePantryItems();
  const deletePantryItem = useDeletePantryItem();

  const [selected, setSelected] = useState<string[]>([]);

  const handleSelect = (ids: string[]) => {
    setSelected(ids);
  };

  const handleConfirmPress = () => {
    if (!selected.length) {
      deleteInteraction.mutate({
        recipe_id: recipe.id,
        interaction_type: "cooked",
      });
    } else {
      selected.forEach((id) => deletePantryItem.mutate({ ingredient_id: id }));
    }
    onDismiss?.();
  };

  useEffect(() => {
    setSelected([]);
  }, [visible]);

  return (
    <Modal
      {...rest}
      confirmButton={{
        content: selected.length ? `Remove (${selected.length})` : "Remove",
      }}
      onConfirm={handleConfirmPress}
      onDismiss={onDismiss}
      visible={visible}
    >
      <View style={{ marginHorizontal: 24, gap: 32 }}>
        <View style={{ gap: 4 }}>
          <Text variant="titleLarge">Manage Pantry</Text>
          <View style={{ gap: 8 }}>
            <Text variant="bodySmall">
              Remove items that you have used, and no longer have in stock
            </Text>
            <View style={{ marginHorizontal: -4, marginTop: 8 }}>
              <PantrySelect
                data={(pantryItems.data ?? []).filter((item) =>
                  ingredients.items.some(
                    (ingredient) => ingredient.id === item.ingredient_id,
                  ),
                )}
                onSelect={handleSelect}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};
