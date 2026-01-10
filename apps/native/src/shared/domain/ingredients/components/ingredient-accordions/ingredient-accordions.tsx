import { View } from "react-native";

import { FilteredCategoriesReturn } from "@/shared/supabase";
import { CategoryListLoading } from "@/shared/ui";

import {
  IngredientAccordion,
  IngredientAccordionProps,
} from "../ingredient-accordion";

export type IngredientsAccordionProps = FilteredCategoriesReturn &
  Pick<IngredientAccordionProps, "compact" | "onSelect" | "selectedIds">;

export const IngredientAccordions = (props: IngredientsAccordionProps) => {
  const { data, isLoading, onSelect, ...rest } = props;

  if (isLoading) {
    return <CategoryListLoading />;
  }

  return (
    <View style={{ gap: 2 }}>
      {data.map((item) => (
        <IngredientAccordion
          key={item.categoryName}
          {...rest}
          {...item}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
};
