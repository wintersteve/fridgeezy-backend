import {
    IllustrateTechniqueRequestSchema,
    IllustrateTechniqueResponseSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { getOrGenerateTechniqueArt } from "../../services";

export const illustrateTechnique = createStreamHandler({
    route: "techniques.illustrate",
    requestSchema: IllustrateTechniqueRequestSchema,
    responseSchema: IllustrateTechniqueResponseSchema,
    handler: async ({ body }) => {
        try {
            const art = await getOrGenerateTechniqueArt(body.action);

            if (!art) {
                // The client resolved a name this table does not have, which
                // means its cached action list is ahead of or behind the
                // server's. A 404 rather than a 500: nothing is broken, there
                // is simply no such technique, and the reply carries on without
                // a picture exactly as it does for the ~140 verbs nobody has
                // asked about yet.
                return {
                    type: "raw" as const,
                    statusCode: 404,
                    data: { error: "Unknown cooking technique" },
                };
            }

            return { type: "json" as const, data: art };
        } catch (error) {
            console.error("[Techniques] Illustration failed:", error);

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to illustrate technique" },
            };
        }
    },
});
