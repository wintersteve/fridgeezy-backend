import {
    GenerateSuggestionRequestSchema,
    RejectedSuggestionRequestSchema,
    StreamedSuggestionSchema,
    SuggestionSlotsSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSuggestionsStream } from "../../services";

export const generateSuggestion = createStreamHandler({
    route: "suggestions.generate",
    requestSchema: GenerateSuggestionRequestSchema,
    // Three frame shapes: how many cards this batch will show, re-sent as that
    // number is learned; the cards themselves, in generation order; and a
    // terminal rejection for a request this catalog will never answer.
    //
    // There is deliberately no per-dish placeholder and no withdrawal any more.
    // Both existed because a slot used to be announced the moment the model
    // wrote a name — before the notability gate, before dedup — so the client
    // drew placeholders the backend then had to take back. Nothing is announced
    // now until a card is certain; see `SuggestionSlotsSchema`.
    //
    // This list is DOCUMENTATION, not enforcement — it read the other way round
    // until 2026-08-06, which is worth knowing before trusting it.
    // `createStreamHandler` only inspects it to choose streaming vs JSON error
    // handling; the single `.parse()` in `handler-factory` is on the REQUEST. A
    // frame shape missing here still reaches the client, and one that
    // contradicts it is not caught. Changing a frame means reading the client,
    // not waiting for a type error.
    responseSchema: [
        SuggestionSlotsSchema,
        StreamedSuggestionSchema,
        RejectedSuggestionRequestSchema,
    ],
    handler: async ({ body }) => {
        // Spread rather than field-by-field. The hand-written copy this replaces
        // silently dropped `exclude` — the list of dishes the client is already
        // showing — so every "generate more" page was free to re-propose page
        // one's dishes, and a field added to the schema reached the generator
        // only if someone remembered to add it here too.
        const stream = generateSuggestionsStream({
            ...body,
            ingredients: body.ingredients || [],
        });

        return {
            type: "stream" as const,
            stream,
        };
    },
});
