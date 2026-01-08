import { z } from "zod/v4";

/**
 * Request schema for escalating a recipe's difficulty level.
 * Defines the contract for external systems calling the escalate difficulty use-case.
 */
export const EscalateDifficultyRequestSchema = z.object({
    recipeId: z.uuid().describe("UUID of the recipe to escalate"),
});

export type EscalateDifficultyRequest = z.infer<
    typeof EscalateDifficultyRequestSchema
>;
