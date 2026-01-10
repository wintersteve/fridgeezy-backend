import { ShoppingListItem } from "@/features/shopping-lists";

export interface ShoppingListProps {
  data: ShoppingListItem;
}

export const ShoppingList = (props: ShoppingListProps) => {
  const { data } = props;

  const { id } = data;

  // const { data: ingredients, isLoading } = useGetIngredients(id);
  //
  // if (!ingredients) return null;
  //
  // return <IngredientsList data={ingredients} loading={isLoading} />;

  return null;
};
