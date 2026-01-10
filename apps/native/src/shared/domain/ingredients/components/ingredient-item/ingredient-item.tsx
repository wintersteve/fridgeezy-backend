import { titleCase } from "@/shared/toolkit";
import { Chip } from "@/shared/ui";

export interface IngredientItemData {
  id: string;
  name: string;
}

export interface IngredientItemProps {
  item: IngredientItemData;
  onPress: (id: string) => void;
  selected?: boolean;
}

export const IngredientItem = (props: IngredientItemProps) => {
  const { item, onPress, selected = false } = props;

  return (
    <Chip key={item.id} selected={selected} onPress={() => onPress(item.id)}>
      {titleCase(item.name)}
    </Chip>
  );
};
