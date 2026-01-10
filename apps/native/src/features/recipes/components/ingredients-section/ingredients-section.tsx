import { useState } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useShoppingLists } from "@/core/supabase";
import { IngredientsList } from "@/features/ingredients";
import { Recipe } from "@/shared/entities";
import { ShoppingListButton } from "@/shared/shopping-lists";
import { useTheme } from "@/shared/theme";
import { Row, Section, Slider } from "@/shared/ui";

export interface IngredientsSectionProps {
  data: Recipe;
}

export const IngredientsSection = ({ data }: IngredientsSectionProps) => {
  const [servings, setServings] = useState<number>(data?.servings ?? 1);

  const { colors } = useTheme();

  const shoppingLists = useShoppingLists();

  const handleSliderChange = (value: number) => {
    setServings(value);
  };

  return (
    <View>
      <Section
        title={`${data.ingredients?.length} Ingredients`}
        style={{ marginHorizontal: 16 }}
        right={<ShoppingListButton compact data={data} />}
      >
        <Row centered wrap={false} spacing={20} style={{ marginHorizontal: 4 }}>
          <Slider
            min={1}
            max={8}
            step={1}
            value={2}
            onValueChange={handleSliderChange}
            // minimumTrackTintColor={colors.primary}
            // maximumTrackTintColor={colors.primaryContainer}
            // thumbTintColor={colors.primary}
          />
          <Row centered spacing={6} style={{ marginRight: 8 }}>
            <Text
              variant="labelMedium"
              style={{ color: colors.onSurfaceDisabled }}
            >
              {servings}
            </Text>
            <Icon
              color={colors.onSurfaceDisabled}
              source="account-multiple"
              size={20}
            />
          </Row>
        </Row>

        <View style={{ gap: 8 }}>
          <IngredientsList
            base={data.servings}
            data={data.ingredients}
            target={servings}
          />
        </View>
      </Section>
    </View>
  );
};
