import {
    SubstituteSuggestionSchema,
    SuggestSubstitutesRequestSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { recordTasteSignal } from "../../../recipes/services";
import { dedupeByName, generateSubstitutesStream } from "../../services";

export const suggestSubstitutes = createStreamHandler({
    route: "substitutes.generate",
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
        //
        // Over the DEDUPED list, which is the same one the stream answers: two
        // selections that canonicalize alike get one card, and counting them
        // twice would let a single request carry a signal past
        // `TASTE_SIGNAL_MIN_OCCURRENCES` on its own. Both sides collapse on
        // `canonicalizeName`, so a collision here is a collision there.
        for (const ingredient of dedupeByName(body.missingIngredients)) {
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
