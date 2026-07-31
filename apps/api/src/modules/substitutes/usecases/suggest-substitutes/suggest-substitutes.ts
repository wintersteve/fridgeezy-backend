import {
    SubstituteSuggestionSchema,
    SuggestSubstitutesRequestSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSubstitutesStream } from "../../services";

export const suggestSubstitutes = createStreamHandler({
    requestSchema: SuggestSubstitutesRequestSchema,
    // Array form, so the factory reports mid-stream failures as an SSE error
    // frame rather than trying to write a JSON error body over headers it has
    // already flushed.
    responseSchema: [SubstituteSuggestionSchema],
    handler: async ({ body }) => ({
        type: "stream" as const,
        stream: generateSubstitutesStream(body),
    }),
});
