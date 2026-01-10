import Slider from "@react-native-community/slider";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useProfileSettings } from "@/core/supabase";
import { Database } from "@/shared/supabase/types";
import { useTheme } from "@/shared/theme";
import { COLORS } from "@/shared/theme/constants/colors";
import { Card, Chip } from "@/shared/ui";

export type DifficultyType = Database["public"]["Enums"]["difficulty_type"];

export const DIFFICULTY_TO_LEVEL: Record<DifficultyType, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export const LEVEL_TO_DIFFICULTY: Record<number, DifficultyType> = {
  1: "easy",
  2: "medium",
  3: "hard",
};

const SKILL_LEVELS = [
  {
    level: 1,
    label: "1-Star Chef",
    description: "Simple recipes with basic techniques and common ingredients.",
    color: COLORS.COMMON.difficultyEasy,
  },
  {
    level: 2,
    label: "2-Star Chef",
    description:
      "More complex dishes requiring some cooking experience and varied techniques.",
    color: COLORS.COMMON.difficultyMedium,
  },
  {
    level: 3,
    label: "3-Star Chef",
    description:
      "Challenging recipes with sophisticated techniques and specialized skills.",
    color: COLORS.COMMON.difficultyHard,
  },
] as const;

export interface SkillsCardProps {
  value?: DifficultyType;
  onChange?: (difficulty: DifficultyType) => void;
}

export const SkillsCard = (props: SkillsCardProps) => {
  const { value, onChange } = props;

  const theme = useTheme();

  const profileSettings = useProfileSettings();

  const difficulty = value ?? profileSettings.data?.difficulty ?? "easy";
  const skillLevel = DIFFICULTY_TO_LEVEL[difficulty];
  const currentLevel = SKILL_LEVELS[skillLevel - 1];

  const handleSliderChange = (sliderValue: number) => {
    const level = Math.round(sliderValue);
    onChange?.(LEVEL_TO_DIFFICULTY[level]);
  };

  return (
    <Card contentStyle={{ padding: 24 }}>
      <View
        style={{
          flexDirection: "row",
          gap: 4,
          marginBottom: 12,
        }}
      >
        {[1, 2, 3].map((star) => (
          <Icon
            key={star}
            source={star <= skillLevel ? "star" : "star-outline"}
            size={32}
            color={
              star <= skillLevel ? currentLevel.color : theme.colors.outline
            }
          />
        ))}
      </View>
      <Chip color={currentLevel.color}>{currentLevel.label}</Chip>
      <View
        style={{
          gap: 16,
          marginVertical: 8,
        }}
      >
        <Slider
          style={{ width: "100%", height: 40 }}
          minimumValue={1}
          maximumValue={3}
          step={1}
          value={skillLevel}
          onValueChange={handleSliderChange}
          minimumTrackTintColor={currentLevel.color}
          maximumTrackTintColor={theme.colors.outline}
          thumbTintColor={currentLevel.color}
        />
      </View>
      <Text
        variant="bodyMedium"
        style={{ color: theme.colors.onSurfaceVariant }}
      >
        {currentLevel.description}
      </Text>
    </Card>
  );
};
