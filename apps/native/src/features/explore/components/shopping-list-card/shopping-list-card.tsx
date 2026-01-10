import { View } from "react-native";
import { Text } from "react-native-paper";

import { RecipeProgress } from "@/features/recipes/components/recipe-progress";
import { RecipeData } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { AnimatedPressable, Card } from "@/shared/ui";

export interface ShoppingListCardProps {
  data: RecipeData;
  onPress: (id: string) => void;
}

export const ShoppingListCard = (props: ShoppingListCardProps) => {
  const { data, onPress } = props;

  const { colors } = useTheme();

  return (
    <AnimatedPressable onPress={() => onPress(data.id)}>
      <Card contentStyle={{ padding: 20 }}>
        <View style={{ gap: 4 }}>
          <RecipeProgress
            text={false}
            strokeColor={colors.primary}
            total={data.ingredients?.length ?? 1}
            size={24}
            thickness={6}
            value={1}
            // value={matchedIngredients}
          />
          <Text numberOfLines={1} ellipsizeMode="tail" variant="titleMedium">
            {data.name}
          </Text>
        </View>

        <Text
          variant="labelSmall"
          style={{ color: colors.onSurfaceVariant, left: 1 }}
        >
          {1} out of {data.ingredients?.length ?? 1} Ingredients
        </Text>
        <Text
          style={{
            color: colors.secondaryContainer,
            fontSize: 60,
            lineHeight: 66,
            position: "absolute",
            right: 0,
          }}
          variant="headlineLarge"
        >
          {(1 / (data.ingredients?.length ?? 1)) * 100}%
        </Text>
      </Card>
    </AnimatedPressable>
  );
};
