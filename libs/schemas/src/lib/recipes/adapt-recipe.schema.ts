import { z } from "zod/v4";

/**
 * Request schema for adapting a catalogue recipe to the caller's diet by
 * swapping the single ingredient standing in the way — the tap behind the
 * near-miss card.
 *
 * ## Why it is not `modify` with a sentence
 *
 * `POST /recipes/modify` takes free text and does what it is told. This route
 * refuses first: `runAdaptationGate` decides whether the dish survives losing
 * this ingredient, and the caller gets no stream at all if it does not. Sending
 * "make it dairy free" through modify would rewrite a Beurre Blanc into
 * something wearing its name, which is the entire failure the near-miss tier
 * was built around.
 *
 * So the two fields are the CLAIM being made, not an instruction: this recipe
 * is one ingredient away from these diets, and the ingredient is that one. The
 * server re-checks both — the blocker must actually be in the recipe — because
 * the catalogue is shared and a near-miss row the client is holding can be
 * stale by the time it is tapped.
 */
export const AdaptRecipeRequestSchema = z.object({
    id: z.uuid().describe("UUID of the catalogue recipe to adapt"),
    /**
     * The ingredient to replace, by NAME as the catalogue holds it — which is
     * what `find_near_miss_recipes` returns on the card. Matched by canonical
     * id server-side, so a spelling or case difference is not a failure, but an
     * ingredient the recipe does not contain is.
     */
    blocker: z
        .string()
        .min(1)
        .describe("Name of the single ingredient standing in the way"),
    /**
     * The diets the result must satisfy, as readable names ("dairy free") —
     * the same form the chat and generation routes take, and for the same
     * reason: these reach a prompt, and a uuid means nothing to a model.
     *
     * More than one is normal. An egg blocks both `vegan` and `egg free` for
     * somebody who set both, and the variant's label names all of them.
     */
    diets: z
        .array(z.string().min(1))
        .min(1)
        .describe("Dietary tag names the adaptation must satisfy"),
});

export type AdaptRecipeRequestDto = z.infer<typeof AdaptRecipeRequestSchema>;

/**
 * The frame sent INSTEAD of a recipe when the gate declines.
 *
 * A frame rather than an HTTP error, because a refusal is an ANSWER: the dish
 * was looked at and it does not survive the swap. A 4xx would put it in the
 * same bucket as a malformed request and hand the client a retry button for a
 * verdict that will not change.
 *
 * `retryable` is what separates the two kinds. `defining_ingredient`,
 * `no_substitute` and `low_confidence` are statements about this dish and are
 * final; `gate_unavailable` means the provider was down or out of credit, and
 * carries whether an identical retry could plausibly land — see `classifyError`
 * for why an exhausted quota and a rate limit must not be offered the same
 * button.
 */
export const AdaptRecipeRefusedSchema = z.object({
    refused: z.literal(true),
    reason: z.enum([
        /** The swap destroys the dish — a Beurre Blanc without butter. */
        "defining_ingredient",
        /**
         * The gate does not recognise the dish at all, so it cannot say whether
         * the swap destroys it. The honest answer for an IMPORTED recipe, which
         * is somebody's own cookbook page and was never in the catalogue the
         * gate judges against.
         */
        "not_attested",
        "no_substitute",
        "low_confidence",
        "gate_unavailable",
    ]),
    retryable: z.boolean(),
});

export type AdaptRecipeRefusedDto = z.infer<typeof AdaptRecipeRefusedSchema>;
