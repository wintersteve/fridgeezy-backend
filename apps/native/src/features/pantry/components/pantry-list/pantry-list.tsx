import { PantryItemWithIngredient } from "@/core/supabase";
import { titleCase } from "@/shared/toolkit";
import { Chip, Row } from "@/shared/ui";

export interface PantryListProps {
  data: PantryItemWithIngredient[];
  disabled?: boolean;
  onPress?: (item: PantryItemWithIngredient) => void;
  selected?: string[];
}

export const PantryList = (props: PantryListProps) => {
  const { data, disabled = false, onPress, selected } = props;

  const isSelected = (item: PantryItemWithIngredient) => {
    const name = item.ingredient?.name?.toUpperCase();
    return selected?.some((id) => id === name);
  };

  return (
    <Row spacing={6} style={{ marginHorizontal: -2 }}>
      {data.map((item) => (
        <Chip
          key={item.id}
          disabled={!isSelected(item) && disabled}
          selected={isSelected(item)}
          onPress={() => onPress?.(item)}
        >
          {titleCase(item.ingredient?.name ?? "")}
        </Chip>
      ))}
    </Row>
  );
};
