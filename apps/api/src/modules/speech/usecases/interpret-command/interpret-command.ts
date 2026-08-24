import { interpretCommand as interpretWithGemini } from "@fridgeezy/genai";
import {
    InterpretCommandRequestSchema,
    InterpretCommandResponseSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

/**
 * `POST /rest/speech/command` — a few seconds of kitchen audio in, one cook-mode
 * intent out. The other half of `/speech/synthesize`: that one lets the app
 * talk, this one lets it listen.
 *
 * Plain JSON rather than SSE. There is exactly one small object to return and
 * the caller can do nothing with a partial classification.
 *
 * Unlike the TTS route there is no cache: the same words spoken twice are
 * different bytes, so a content hash would never hit.
 */
export const interpretCommand = createStreamHandler({
    route: "speech.interpret",
    requestSchema: InterpretCommandRequestSchema,
    responseSchema: InterpretCommandResponseSchema,
    // Base64 audio arrives as one large body, the same reason
    // `/ingredients/extract` sets this.
    useBufferedParser: true,

    handler: async ({ body }) => {
        try {
            const result = await interpretWithGemini({
                audioBase64: body.audio,
                mimeType: body.mimeType,
                stepText: body.stepText,
            });

            return { type: "json" as const, data: result };
        } catch (error) {
            console.error("[Speech] Command interpretation failed:", error);

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: "Failed to interpret command" },
            };
        }
    },
});
