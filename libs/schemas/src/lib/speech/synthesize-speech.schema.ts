import { z } from "zod/v4";

/**
 * Request schema for turning recipe text into spoken audio.
 *
 * The cap matches what a single cook step ever runs to in practice — enough
 * headroom for a long instruction, not enough to let a caller submit an entire
 * recipe's method as one utterance.
 */
export const SynthesizeSpeechRequestSchema = z.object({
    text: z.string().min(1).max(2000),
});

/**
 * `audioUrl` points at a WAV file (RIFF header included, not headerless PCM —
 * Gemini's TTS models return raw PCM with no container, wrapped server-side)
 * in public storage rather than carrying the bytes inline. The clip is cached
 * there keyed on the text itself, so identical step text — the same recipe
 * read by a second user, or a step whose wording repeats across recipes —
 * resolves to the same file instead of paying for another Gemini call. A URL
 * also lets the client hand it straight to an audio player instead of
 * decoding a base64 blob on every play.
 */
export const SynthesizeSpeechResponseSchema = z.object({
    audioUrl: z.string(),
});

export type SynthesizeSpeechRequestDto = z.infer<
    typeof SynthesizeSpeechRequestSchema
>;

export type SynthesizeSpeechResponseDto = z.infer<
    typeof SynthesizeSpeechResponseSchema
>;
