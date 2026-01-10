import { ScrollViewProps } from "react-native";

import {
  useProfileRecipeInteractions,
  useShoppingLists,
} from "@/core/supabase";
import { EmptyCard, Link, ScrollView, Skeleton } from "@/shared/ui";

import { RecipeCard, RecipeCardData } from "../recipe-card";

export interface RecipeCardsProps
  extends Pick<
    ScrollViewProps,
    "contentContainerStyle" | "horizontal" | "style"
  > {
  data?: RecipeCardData[];
  isLoading?: boolean;
  onPress?: VoidFunction;
}

export const RecipeCards = (props: RecipeCardsProps) => {
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

  if (data.length === 0)
    return <EmptyCard title="Empty" description="No popular recipes found" />;

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
        <Link key={item.id} href={`/recipes/${data.id}`}>
          <RecipeCard
            data={{
              ...item,
              isCooked: cooked.data?.some((c) => c.recipe_id === item.id),
              isShoppingList: shoppingLists.data?.some(
                (s) => s.recipe_id === item.id,
              ),
            }}
            onPress={onPress}
          />
        </Link>
      ))}
    </ScrollView>
  );
};
