import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRef } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { Recipe } from "@/shared/entities";
import { useTheme } from "@/shared/theme";
import { Button, Card, Row, Section } from "@/shared/ui";

import { useStepExplanationStore } from "../../hooks/use-step-explanation-store";
import { StepCard } from "../step-card";
import { StepExplanationBottomSheet } from "../step-explanation-bottom-sheet";

export interface StepsSectionProps {
  data: Recipe;
}

export const StepsSection = (props: StepsSectionProps) => {
  const { data } = props;

  const { colors } = useTheme();
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const stepExplanationStore = useStepExplanationStore();

  const handleExplainPress = (stepNumber: number, instruction: string) => {
    stepExplanationStore.setStep(data.id, stepNumber, instruction);
  };

  const handleDismiss = () => {
    stepExplanationStore.reset();
  };

  return (
    <>
      <Section
        title={`${data.instructions.length} Steps`}
        style={{ marginHorizontal: 16 }}
        right={
          <Row>
            <Button
              icon="text"
              mode="text"
              size="none"
              textColor={colors.onSurfaceDisabled}
            >
              Instructions
            </Button>
          </Row>
        }
      >
        <View style={{ gap: 6 }}>
          {data.instructions.length > 0 ? (
            data.instructions.map((value, index) => (
              <StepCard
                key={value}
                stepNumber={index + 1}
                instruction={value}
                ingredients={
                  (data.ingredients as any)?.map?.(
                    (item: any) => item.ingredient?.name,
                  ) ?? []
                }
                recipeId={data.id}
                recipeName={data.name}
                onExplainPress={handleExplainPress}
              />
            ))
          ) : (
            <Card contentStyle={{ padding: 24 }}>
              <View style={{ gap: 4 }}>
                <Icon color={colors.error} source="close-thick" size={32} />
                <Text variant="headlineSmall">No steps</Text>
                <Text variant="bodySmall" style={{ marginRight: 40 }}>
                  We couldn&apos;t find any recipes. Try adjusting your
                  ingredients
                </Text>
              </View>
            </Card>
          )}
        </View>
      </Section>

      <StepExplanationBottomSheet
        ref={bottomSheetRef}
        recipeId={data.id}
        recipeName={data.name}
        stepNumber={stepExplanationStore.stepNumber}
        instruction={stepExplanationStore.instruction}
        visible={stepExplanationStore.visible}
        onDismiss={handleDismiss}
      />
    </>
  );
};
