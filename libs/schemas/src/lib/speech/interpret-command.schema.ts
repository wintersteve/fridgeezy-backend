import { z } from "zod/v4";

/**
 * What a cook can say mid-recipe. Deliberately a short, closed list: the model
 * is classifying an utterance into a handful of buckets, not planning, and a
 * small vocabulary is what keeps that reliable enough to act on without
 * confirmation.
 *
 * `question` is the escape hatch — anything that isn't a control command is a
 * question about the dish, and the client forwards it to the recipe chat.
 * `unknown` covers a misfire (a hum, the extractor fan, a sentence aimed at
 * someone else in the kitchen) and must never be guessed into an action: the
 * cost of a wrong `next` is the cook losing their place with wet hands.
 */
export const CookCommandActionSchema = z.enum([
    "next",
    "back",
    "repeat",
    "timer",
    "question",
    "stop",
    "unknown",
]);

/**
 * WAV rather than the m4a an iOS recorder reaches for by default: Gemini's
 * documented audio formats do not include the MP4 container, and a mislabelled
 * one fails at the model rather than at the schema.
 */
export const InterpretCommandRequestSchema = z.object({
    /** Base64-encoded audio of a single short utterance. */
    audio: z.string().min(1),
    mimeType: z.enum(["audio/wav", "audio/mp3", "audio/aac", "audio/flac"]),
    /**
     * The step on screen. Supplied so "how long does this need?" can be
     * answered from what the cook is actually looking at, and so a duration
     * spoken as "set a timer for that" can be resolved.
     */
    stepText: z.string().max(2000).optional(),
});

export const InterpretCommandResponseSchema = z.object({
    action: CookCommandActionSchema,
    /** Seconds for `timer`, else null. */
    seconds: z.number().int().positive().max(86_400).nullable(),
    /** The question to forward for `question`, else null. */
    question: z.string().max(500).nullable(),
    /** What was heard. Shown back to the cook so a misfire is legible. */
    transcript: z.string(),
});

export type CookCommandAction = z.infer<typeof CookCommandActionSchema>;

export type InterpretCommandRequestDto = z.infer<
    typeof InterpretCommandRequestSchema
>;

export type InterpretCommandResponseDto = z.infer<
    typeof InterpretCommandResponseSchema
>;
