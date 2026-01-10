import { useSSEAccumulator } from "@/shared/streaming";

import type {
  SuggestionIngredient,
  Suggestion,
} from "/Users/steve/WebstormProjects/fridgeezy-backend/dist/mcp/types";

export const useSuggestRecipe = (data: SuggestionIngredient) => {
  const hasValidData = Object.values(data).some(
    (value) => value !== undefined && value !== null && value !== "",
  );

  return useSSEAccumulator<Suggestion>({
    url: `${process.env.EXPO_PUBLIC_BACKEND_URL}/suggestions/generate`,
    body: data,
    cache: {
      queryKey: ["backend", "suggestions", JSON.stringify(data)],
      checkCache: true,
      saveOnComplete: true,
      isCacheValid: (cached) => (cached && cached.length > 0) ?? false,
    },
    enabled: hasValidData,
    dependencies: [JSON.stringify(data)],
  });
};
