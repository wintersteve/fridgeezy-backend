import { z } from "zod/v4";

/**
 * Request body for `POST /rest/recipes/:recipeId/personalise`.
 *
 * **There is deliberately no instruction field.** What to change is read on the
 * server from `profile_taste_signals` — the things this cook has asked for more
 * than once. A client-supplied instruction would just be `POST /recipes/modify`,
 * which already exists; the whole point of this endpoint is that the app knows
 * what to offer without being told.
 *
 * It is also what keeps the feedback loop closed: `modify` records what you ask
 * it for as a new taste signal, and if applying your preferences went through
 * that path, every application would reinforce itself.
 *
 * `dietaryRestrictions` is passed for the same reason `modify` takes it — the
 * profile's restrictions live on the client, and the prompt must respect them
 * while rewriting.
 */
export const PersonaliseRecipeRequestSchema = z.object({
    dietaryRestrictions: z.array(z.string()).optional(),
});

export type PersonaliseRecipeRequestDto = z.infer<
    typeof PersonaliseRecipeRequestSchema
>;
