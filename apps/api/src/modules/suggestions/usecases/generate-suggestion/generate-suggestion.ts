import {
    GenerateSuggestionRequestSchema,
    ProvisionalSuggestionSchema,
    StreamedSuggestionSchema,
    WithdrawnSuggestionSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSuggestionsStream } from "../../services";

export const generateSuggestion = createStreamHandler({
    requestSchema: GenerateSuggestionRequestSchema,
    // Two frame shapes: the provisional card sent as soon as the model
    // writes it, then the persisted one carrying the same tempId.
    responseSchema: [
        ProvisionalSuggestionSchema,
        StreamedSuggestionSchema,
        WithdrawnSuggestionSchema,
    ],
    handler: async ({ body }) => {
        const stream = generateSuggestionsStream({
            ingredients: body.ingredients || [],
            blacklist: body.blacklist,
            component: body.component,
            course: body.course,
            cuisine: body.cuisine,
            difficulty: body.difficulty,
            dietaryRestrictions: body.dietaryRestrictions,
        });

        return {
            type: "stream" as const,
            stream,
        };
    },
});
