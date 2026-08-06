import {
    GenerateSuggestionRequestSchema,
    ProvisionalSuggestionSchema,
    RejectedSuggestionRequestSchema,
    StreamedSuggestionSchema,
    WithdrawnSuggestionSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSuggestionsStream } from "../../services";

export const generateSuggestion = createStreamHandler({
    requestSchema: GenerateSuggestionRequestSchema,
    // Four frame shapes: the provisional card sent as soon as the model writes
    // it, then the persisted one carrying the same tempId, a withdrawal for a
    // card that will never be enriched, and a terminal rejection for a request
    // this catalog will never answer.
    //
    // Every emitted frame is validated against this list, so a shape missing
    // here is dropped at the boundary rather than reaching the client.
    responseSchema: [
        ProvisionalSuggestionSchema,
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
