import {
    AdaptRecipeRefusedSchema,
    AdaptRecipeRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import {
    adaptRecipeForDiet,
    callerMayReadRecipe,
    fetchRecipe,
} from "../../services";

/**
 * `POST /rest/recipes/:recipeId/adapt` — the tap behind a near-miss card.
 *
 * Turns "this dish is one ingredient away from your diet" into "here is that
 * dish, adapted", as a variant of the family. **Or into a refusal**, which is
 * the outcome this route exists to make possible: `runAdaptationGate` decides
 * whether the dish survives losing the ingredient before anything is generated,
 * and a dish that does not survive is declined rather than mangled.
 *
 * ## The refusal is a frame, not a status code
 *
 * `{refused: true, reason, retryable}` goes out over the same SSE stream and the
 * connection closes normally. A 4xx would file "a Beurre Blanc cannot be made
 * dairy-free" alongside "your request was malformed" and offer the same retry
 * button for both. The reason is what the client says; `retryable` is whether
 * it may offer to try again, and only `gate_unavailable` is ever true — the
 * other three are statements about the dish and will not change on a second
 * ask. See `classifyError` for why an exhausted credit balance and a rate limit
 * must not look alike here.
 *
 * ## What a caller may CLAIM, and the one thing it may not
 *
 * Only a terminal frame carrying `saved: true` AND an `id` describes an adapted
 * recipe. Everything else — a refusal, a generation failure, a rewrite that
 * kept the ingredient, a persist error — arrives as `saved: false` with no id,
 * and an id is the only thing a client can open. So there is no shape in which
 * ignoring `saved` still shows an unadapted dish as adapted; see
 * `adaptRecipeForDiet`'s header for why that is enforced in code rather than
 * asked of the prompt.
 *
 * The success frame carries `swapped: {from, to}`. Copy may promise exactly
 * that much — "we swapped the butter for olive oil" — because that is what was
 * verified. It may not promise that the result is a GOOD dairy-free version;
 * nothing checked that, and the gate's job was only to rule out the dish being
 * destroyed by the swap.
 *
 * **Premium, by the mount.** A model runs — three calls on the happy path, two
 * on a refusal — so it is paid under the app's one-sentence rule. No
 * `requireEntitlement` here; the mount applies it.
 */
export const adaptRecipe = createStreamHandler({
    route: "recipes.adapt",
    requestSchema: AdaptRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
        AdaptRecipeRefusedSchema,
    ],

    handler: async ({ body, req }) => {
        const existingRecipe = await fetchRecipe(body.id);

        // An owned recipe (an import) is readable only by its owner, and this
        // fetch goes through the service-role client that sees past the RLS
        // enforcing that. Folded into the not-found branch, so "you may not read
        // it" and "it is not there" stay indistinguishable.
        if (
            !existingRecipe ||
            !(await callerMayReadRecipe(existingRecipe.createdBy, req))
        ) {
            throw new Error(`Recipe not found: ${body.id}`);
        }

        const outcome = await adaptRecipeForDiet({
            recipeId: body.id,
            blocker: body.blocker,
            diets: body.diets,
        });

        // `null` means the recipe vanished between the two reads above, or its
        // family could not be resolved. A fault rather than an answer, so it
        // throws and `handleError` classifies and logs it — a refusal frame here
        // would report a broken lookup as a judgement about the dish.
        if (!outcome) {
            throw new Error(`Could not adapt recipe: ${body.id}`);
        }

        if ("refused" in outcome) {
            // Destructured out of the union BEFORE the generator, because a
            // narrowing does not survive the closure — inside it, `outcome` is
            // the union again and both fields are gone.
            const { reason, retryable } = outcome;

            async function* refusal() {
                yield { refused: true as const, reason, retryable };
            }

            return { type: "stream" as const, stream: refusal() };
        }

        return { type: "stream" as const, stream: outcome.stream };
    },
});
