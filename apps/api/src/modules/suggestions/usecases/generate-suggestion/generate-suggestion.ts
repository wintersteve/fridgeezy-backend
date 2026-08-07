import {
    GenerateSuggestionRequestSchema,
    PendingSuggestionSchema,
    RejectedSuggestionRequestSchema,
    StreamedSuggestionSchema,
    WithdrawnSuggestionSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSuggestionsStream } from "../../services";

export const generateSuggestion = createStreamHandler({
    requestSchema: GenerateSuggestionRequestSchema,
    // Four frame shapes: a pending slot sent as soon as the model writes the
    // dish, then the persisted card carrying the same tempId, a withdrawal for
    // a slot that will never become one, and a terminal rejection for a request
    // this catalog will never answer.
    //
    // This list is DOCUMENTATION, not enforcement — it read the other way round
    // until 2026-08-06, which is worth knowing before trusting it.
    // `createStreamHandler` only inspects it to choose streaming vs JSON error
    // handling; the single `.parse()` in `handler-factory` is on the REQUEST. A
    // frame shape missing here still reaches the client, and one that
    // contradicts it is not caught. Changing a frame means reading the client,
    // not waiting for a type error.
    responseSchema: [
        PendingSuggestionSchema,
        StreamedSuggestionSchema,
        WithdrawnSuggestionSchema,
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
