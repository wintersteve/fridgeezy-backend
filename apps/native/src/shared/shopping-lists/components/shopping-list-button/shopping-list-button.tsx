import { Icon } from "react-native-paper";

import {
  useDeleteShoppingList,
  useInsertShoppingList,
  useShoppingLists,
} from "@/core/supabase";
import { Recipe } from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { Button } from "@/shared/ui";

export interface ShoppingListButtonProps {
  compact?: boolean;
  data: Pick<Recipe, "id">;
  readonly?: boolean;
  iconSize?: number;
  size?: number;
}

export const ShoppingListButton = (props: ShoppingListButtonProps) => {
  const {
    compact = false,
    data,
    iconSize = 24,
    readonly = false,
    size,
  } = props;

  const { id } = data;

  const { colors } = useTheme();

  const shoppingLists = useShoppingLists();
  const insertShoppingList = useInsertShoppingList();
  const deleteShoppingList = useDeleteShoppingList();

  const hasShoppingList = shoppingLists.data?.some((s) => s.recipe_id === id);

  const handlePress = () => {
    if (hasShoppingList) {
      deleteShoppingList.mutate({ recipe_id: id });
    } else {
      insertShoppingList.mutate({ recipe_id: id });
    }
  };

  if (readonly && size) {
    return (
      <Icon
        source="basket"
        size={size}
        color={hasShoppingList ? colors.onSurface : colors.onSurfaceDisabled}
      />
    );
  }

  if (compact) {
    return (
      <Button
        icon={hasShoppingList ? "card-minus" : "card-plus"}
        onPress={handlePress}
        mode="text"
        size="none"
        textColor={hasShoppingList ? colors.primary : colors.onSurfaceDisabled}
      >
        List
      </Button>
    );
  }

  return hasShoppingList ? (
    <Button mode="text" icon="basket-minus" onPress={handlePress}>
      Remove from Shopping List
    </Button>
  ) : (
    <Button mode="text" icon="basket-plus" onPress={handlePress}>
      Add to Shopping List
    </Button>
  );
};
