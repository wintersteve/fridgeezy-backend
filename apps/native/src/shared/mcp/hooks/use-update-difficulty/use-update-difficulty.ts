import { useSSEAccumulator } from "@/shared/streaming";
import type { Suggestion } from "@/types/suggestion";

export const useUpdateDifficulty = (id: string) => {
  return useSSEAccumulator<Suggestion>({
    url: "http://localhost:8000/escalate-difficulty",
    body: { recipeId: id },
    cache: {
      queryKey: ["MCP", "UPDATE_DIFFICULTY", id],
      checkCache: true,
      saveOnComplete: true,
      isCacheValid: (cached) => cached && cached.length > 0,
    },
    enabled: !!id,
    dependencies: [id],
  });
};
