import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { RecipeData } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { withAlpha } from "@/shared/toolkit";
import { CircularProgress, Row } from "@/shared/ui";

export interface NutrientsSectionProps {
  MOCK: RecipeData;
}

const MOCK = {
  calories: {
    absolute: {
      carbs: 100,
      calories: 100,
      fat: 100,
      protein: 100,
    },
    relative: {
      carbs: 0.1,
      calories: 1,
      fat: 0.2,
      protein: 0.7,
    },
  },
};

export const NutrientsSection = (props: NutrientsSectionProps) => {
  const { data } = props;

  const theme = useTheme();

  const items = [
    {
      title: "Carbs",
      absolute: MOCK.calories.absolute.carbs,
      relative: MOCK.calories.relative.carbs,
      unit: "g",
    },
    {
      title: "Protein",
      absolute: MOCK.calories.absolute.protein,
      relative: MOCK.calories.relative.protein,
      unit: "g",
    },
    {
      title: "Fat",
      absolute: MOCK.calories.absolute.fat,
      relative: MOCK.calories.relative.fat,
      unit: "g",
    },
  ];

  // Sort items by relative value to assign difficulty colors
  const sortedByValue = [...items].sort((a, b) => a.relative - b.relative);

  // Create a map of title to difficulty color
  const colorMap: Record<string, string> = {
    [sortedByValue[0].title]: theme.colors.difficultyEasy,
    [sortedByValue[1].title]: theme.colors.difficultyMedium,
    [sortedByValue[2].title]: theme.colors.difficultyHard,
  };

  return (
    <View style={{ gap: 12 }}>
      <Row centered spacing={17}>
        {items.map((item) => (
          <View key={item.title} style={styles.progress}>
            <CircularProgress
              size={64}
              color={withAlpha(colorMap[item.title], 0.2)}
              strokeColor={colorMap[item.title]}
              thickness={6}
              value={item.relative}
            >
              <View style={styles.value}>
                <Text
                  style={{ color: colorMap[item.title] }}
                  variant="labelSmall"
                >
                  {parseInt(item.absolute.toString())}
                  {item.unit}
                </Text>
                <Text
                  style={{
                    color: colorMap[item.title],
                    fontSize: 10,
                    lineHeight: 14,
                  }}
                  variant="bodySmall"
                >
                  {item.title}
                </Text>
              </View>
            </CircularProgress>
          </View>
        ))}
      </Row>
    </View>
  );
};

const styles = StyleSheet.create({
  progress: { gap: 4 },
  text: { textAlign: "right" },
  value: { alignItems: "center" },
});
