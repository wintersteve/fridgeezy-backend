import { z } from "zod/v4";

/**
 * Request schema for escalating a recipe's difficulty level.
 * Defines the contract for external systems calling the escalate difficulty use-case.
 */
export const EscalateDifficultyRequestSchema = z.object({
    id: z.uuid().describe("UUID of the recipe to escalate"),
    difficulty: z
        .enum(["easy", "medium", "hard"])
        .describe("Target difficulty level"),
});

/** Consumed by the client app (`useEscalateDifficulty`) via the published tarball. */
export type EscalateDifficultyRequestDto = z.infer<
    typeof EscalateDifficultyRequestSchema
>;

