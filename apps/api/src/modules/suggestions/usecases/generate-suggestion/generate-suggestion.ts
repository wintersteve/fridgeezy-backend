import {
    EnrichedSuggestionResponseSchema,
    GenerateSuggestionRequestSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { generateSuggestionsStream } from "../../services";

export const generateSuggestion = createStreamHandler({
    requestSchema: GenerateSuggestionRequestSchema,
    responseSchema: EnrichedSuggestionResponseSchema,
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
