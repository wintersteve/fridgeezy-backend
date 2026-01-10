import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { withAlpha } from "@/shared/toolkit";
import { CircularProgress, CircularProgressProps, Row } from "@/shared/ui";

export interface RecipeProgressProps
  extends Pick<CircularProgressProps, "size" | "strokeColor" | "thickness"> {
  text?: boolean;
  total: number;
  value: number;
}

export const RecipeProgress = (props: RecipeProgressProps) => {
  const { size = 14, text = true, thickness = 4, total, value } = props;

  const { colors } = useTheme();

  const getColors = () => {
    if (value / total > 0.66)
      return {
        color: withAlpha(colors.difficultyEasy, 0.3),
        strokeColor: colors.difficultyEasy,
      };

    if (value / total > 0.33)
      return {
        color: withAlpha(colors.difficultyMedium, 0.3),
        strokeColor: colors.difficultyMedium,
      };

    return {
      color: withAlpha(colors.difficultyHard, 0.3),
      strokeColor: colors.difficultyHard,
    };
  };

  return (
    <Row centered spacing={6} style={{ left: 1 }}>
      <CircularProgress
        {...getColors()}
        size={size}
        thickness={thickness}
        value={value / total}
      />
      {text && (
        <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
          {value} out of {total} Ingredients
        </Text>
      )}
    </Row>
  );
};
