import {
    SynthesizeSpeechRequestSchema,
    SynthesizeSpeechResponseSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

import { getOrSynthesizeSpeech } from "../../services";

export const synthesizeSpeech = createStreamHandler({
    route: "speech.synthesize",
    requestSchema: SynthesizeSpeechRequestSchema,
    responseSchema: SynthesizeSpeechResponseSchema,
    handler: async ({ body }) => {
        try {
            const audioUrl = await getOrSynthesizeSpeech(body.text);

            return { type: "json" as const, data: { audioUrl } };
        } catch (error) {
            console.error("[Speech] Synthesis failed:", error);

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to synthesize speech" },
            };
        }
    },
});
