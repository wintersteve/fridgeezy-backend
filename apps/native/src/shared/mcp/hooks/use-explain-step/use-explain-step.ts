import { useSSEConcatenator } from "@/shared/streaming";

export interface ExplainStepParams {
  recipeId: string;
  recipeName: string;
  stepNumber: number;
  instruction: string;
  enabled?: boolean;
}

export interface StepExplanation {
  explanation: string;
}

export const useExplainStep = (params: ExplainStepParams) => {
  const {
    recipeId,
    recipeName,
    stepNumber,
    instruction,
    enabled = true,
  } = params;

  const result = useSSEConcatenator({
    url: "http://localhost:8000/explain-step",
    body: { recipeId, recipeName, stepNumber, instruction },
    textField: "text",
    cache: {
      queryKey: ["MCP", "EXPLAIN_STEP", recipeId, stepNumber],
      checkCache: true,
      saveOnComplete: true,
    },
    enabled:
      enabled &&
      !!recipeId &&
      !!recipeName &&
      !!instruction &&
      stepNumber != null,
    dependencies: [recipeId, stepNumber],
  });

  return {
    ...result,
    data: result.data ? { explanation: result.data } : null,
  };
};
