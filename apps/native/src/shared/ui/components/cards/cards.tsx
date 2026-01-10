import { ScrollViewProps } from "react-native";

import {
  useProfileRecipeInteractions,
  useShoppingLists,
} from "@/core/supabase";
import { ScrollView, Skeleton } from "@/shared/ui";

import { RecipeCard } from "../recipe-card";

export interface CardsProps<T>
  extends Pick<
    ScrollViewProps,
    "contentContainerStyle" | "horizontal" | "style"
  > {
  data?: T[];
  isLoading?: boolean;
  onPress?: VoidFunction;
}

export const Cards = <T,>(props: CardsProps<T>) => {
  const {
    contentContainerStyle,
    data = [],
    horizontal = false,
    isLoading = false,
    onPress,
    style,
  } = props;

  const cooked = useProfileRecipeInteractions("cooked");
  const shoppingLists = useShoppingLists();

  if (isLoading) {
    return (
      <ScrollView
        horizontal
        contentContainerStyle={[{ gap: 8 }, contentContainerStyle]}
      >
        <Skeleton borderRadius={8} height={158} width={212} />
        <Skeleton borderRadius={8} height={158} width={212} />
      </ScrollView>
    );
  }

  if (data.length === 0) return null;

  return (
    <ScrollView
      contentContainerStyle={[
        { paddingHorizontal: horizontal ? 0 : 16, gap: 8 },
        contentContainerStyle,
      ]}
      style={style}
      horizontal={horizontal}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      {data.map((item) => (
        <RecipeCard
          key={item.id}
          data={{
            ...item,
            isCooked: cooked.data?.some((c) => c.recipe_id === item.id),
            isShoppingList: shoppingLists.data?.some(
              (s) => s.recipe_id === item.id,
            ),
          }}
          onPress={onPress}
        />
      ))}
    </ScrollView>
  );
};
