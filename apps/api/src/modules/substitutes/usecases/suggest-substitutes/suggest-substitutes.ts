import {
    SubstituteSuggestionSchema,
    SuggestSubstitutesRequestSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { recordTasteSignal } from "../../../recipes/services";
import { generateSubstitutesStream } from "../../services";

export const suggestSubstitutes = createStreamHandler({
    requestSchema: SuggestSubstitutesRequestSchema,
    // Array form, so the factory reports mid-stream failures as an SSE error
    // frame rather than trying to write a JSON error body over headers it has
    // already flushed.
    responseSchema: [SubstituteSuggestionSchema],
    handler: async ({ body, req }) => {
        // An ingredient someone asks to replace ONCE is a shopping accident; the
        // same one twice is a thing they do not keep in the house. The threshold
        // is what tells those apart, so both are recorded and only the repeat
        // reaches a prompt.
        for (const ingredient of body.missingIngredients) {
            recordTasteSignal(req, "substitution", ingredient.name);
        }

        return {
            type: "stream" as const,
            // `req` is threaded through so an owned recipe (an import) enriches
            // only its own owner's prompt — see the fetch in
            // `generateSubstitutesStream`.
            stream: generateSubstitutesStream(body, undefined, req),
        };
    },
});
