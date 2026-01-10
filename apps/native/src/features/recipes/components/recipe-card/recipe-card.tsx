import { StyleSheet, View } from "react-native";
import { Icon, ProgressBar, Text } from "react-native-paper";

import { FavoriteButton, RecipeTags } from "@/features/recipes";
import { Recipe } from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Card, Row } from "@/shared/ui";

import { RecipeProgress } from "../recipe-progress";

export interface RecipeCardData extends Recipe {
  isCooked?: boolean;
  isShoppingList?: boolean;
}

export interface RecipeCardProps {
  data: Recipe;
  onPress?: VoidFunction;
  fullWidth?: boolean;
}

export const RecipeCard = (props: RecipeCardProps) => {
  const { data, fullWidth = false, onPress } = props;

  // const matchedIngredients = data.ingredients.items.filter((ingredient) =>
  //   pantryStore.data.some((item) => item.id === ingredient.id),
  // ).length;

  const { colors } = useTheme();

  return (
    <Card contentStyle={{ padding: fullWidth ? 6 : 0 }} onPress={onPress}>
      <View style={styles.body}>
        <View style={{ gap: 4 }}>
          <Row centered between style={{ marginHorizontal: 1 }}>
            <ProgressBar
              color={colors[`difficulty${titleCase(data.difficulty)}`]}
              progress={1}
              style={{ borderRadius: 100, height: 8, width: 20 }}
            />
            <Row spacing={6} style={{ position: "absolute", top: 0, right: 0 }}>
              <View style={{ marginRight: 3 }}>
                <Icon
                  color={
                    data.isShoppingList
                      ? colors.primary
                      : colors.onSurfaceDisabled
                  }
                  source="basket"
                  size={fullWidth ? 18 : 14}
                />
              </View>
              <FavoriteButton data={data} readonly size={fullWidth ? 18 : 14} />
              <Icon
                color={
                  data.isCooked ? colors.primary : colors.onSurfaceDisabled
                }
                source="check-bold"
                size={fullWidth ? 18 : 14}
              />
            </Row>
          </Row>

          <View style={{ gap: 1, marginVertical: 4 }}>
            <Text numberOfLines={1} ellipsizeMode="tail" variant="titleMedium">
              {data.name}
            </Text>
            <Text
              style={{ color: colors.onSurfaceVariant }}
              variant="bodySmall"
            >
              {data.description.slice(0, fullWidth ? 80 : 30)}...
            </Text>
          </View>

          <RecipeProgress
            strokeColor={colors.primary}
            total={data.ingredients?.length ?? 1}
            value={1}
            // value={matchedIngredients}
          />
        </View>

        <View style={styles.categories}>
          <RecipeTags data={data} max={2} />
        </View>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  body: { gap: 2, padding: 14 },
  categories: { marginTop: 8 },
});
