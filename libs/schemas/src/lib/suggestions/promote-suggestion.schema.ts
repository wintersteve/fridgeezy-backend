import { z } from "zod";

/**
 * Request schema for promoting a suggestion to a recipe
 */
export const PromoteSuggestionRequestSchema = z.object({
  servings: z.number().int().positive().default(4),
  /**
   * The caller's blacklisted ingredients, so the recipe can't reintroduce
   * something the suggestion was adapted around.
   *
   * The suggestion's ingredient list is already clean — the generator swapped
   * the item out — and promotion is told to use ONLY that list, so this is a
   * guard rather than a substitution instruction: it stops the model adding the
   * item back in a step, a garnish or a serving suggestion, which "use only
   * these ingredients" does not literally forbid.
   */
  blacklist: z.array(z.string()).optional(),
});
