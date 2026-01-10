import * as Haptics from "expo-haptics";
import { Text } from "react-native-paper";

import { IngredientLine } from "@/shared/recipes";
import { useTheme } from "@/shared/theme";
import { Card, ContextMenu, Row } from "@/shared/ui";

export interface StepCardProps {
  stepNumber: number;
  instruction: string;
  ingredients: string[];
  recipeId: string;
  recipeName: string;
  onExplainPress: (stepNumber: number, instruction: string) => void;
}

export const StepCard = (props: StepCardProps) => {
  const { stepNumber, instruction, ingredients, onExplainPress } = props;

  const { colors } = useTheme();

  const actions = [
    {
      id: "explain",
      label: "Explain This Step",
      icon: "message-question",
      onPress: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onExplainPress(stepNumber, instruction);
      },
    },
  ];

  return (
    <ContextMenu actions={actions}>
      <Card contentStyle={{ padding: 12, minHeight: 80 }}>
        <Text
          style={{
            color: colors.secondaryContainer,
            fontSize: 64,
            lineHeight: 72,
            position: "absolute",
            right: 0,
          }}
          variant="headlineLarge"
        >
          {stepNumber}
        </Text>
        <Row spacing={14} wrap={false}>
          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginRight: 52 }}
          >
            <IngredientLine text={instruction} ingredients={ingredients} />
          </Text>
        </Row>
      </Card>
    </ContextMenu>
  );
};
