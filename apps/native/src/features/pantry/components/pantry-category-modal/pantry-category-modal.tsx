import { useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { PantryItemWithIngredient } from "@/core/supabase";
import { IngredientCategory } from "@/features/ingredients/types";
import { useIngredients } from "@/shared/supabase";
import { titleCase } from "@/shared/toolkit";
import { Modal, ModalProps } from "@/shared/ui";

import { PantrySelect } from "../pantry-select";

export interface PantryCategoryModalProps
  extends Omit<ModalProps, "onConfirm"> {
  data: IngredientCategory;
  onConfirm: (ids: string[]) => void;
}

export const PantryCategoryModal = (props: PantryCategoryModalProps) => {
  const { data, onConfirm, onDismiss, visible } = props;

  const ingredients = useIngredients();

  const [selected, setSelected] = useState<string[]>([]);

  const categoryIngredients = useMemo<PantryItemWithIngredient[]>(() => {
    if (!ingredients.data) return [];

    return ingredients.data
      .filter(
        (ingredient) =>
          ingredient.categories?.name?.toUpperCase() === data.toUpperCase(),
      )
      .map((ingredient) => ({
        id: ingredient.id,
        ingredient_id: ingredient.id,
        profile_id: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ingredient: { id: ingredient.id, name: ingredient.name },
      }));
  }, [ingredients.data, data]);

  const handleSelect = (ids: string[]) => {
    setSelected(ids);
  };

  const handleConfirm = () => {
    onDismiss?.();
    onConfirm(selected);
  };

  return (
    <Modal
      hideFooter={!selected.length}
      confirmButton={{ content: `Add (${selected.length})` }}
      left={<Text variant="titleLarge">{titleCase(data)}</Text>}
      visible={visible}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <PantrySelect data={categoryIngredients} onSelect={handleSelect} />
      </View>
    </Modal>
  );
};
