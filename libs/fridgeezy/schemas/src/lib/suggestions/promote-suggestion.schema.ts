import { z } from "zod";

/**
 * Request schema for promoting a suggestion to a recipe
 */
export const PromoteSuggestionRequestSchema = z.object({
  servings: z.number().int().positive().default(4),
});

export type PromoteSuggestionRequestDto = z.infer<typeof PromoteSuggestionRequestSchema>;
