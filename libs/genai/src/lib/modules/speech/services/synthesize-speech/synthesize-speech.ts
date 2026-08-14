import { ApiError, Modality } from "@google/genai";

import { genai } from "../../../client";

import { parsePcmMimeType, pcmToWav } from "./pcm-to-wav";

export interface SynthesizeSpeechOptions {
    text: string;
    /** One of Gemini's ~30 prebuilt voice names, e.g. "Kore", "Puck". */
    voiceName?: string;
    model?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts";
}

export interface SynthesizedSpeech {
    /** A complete WAV file, base64-encoded — see {@link pcmToWav}. */
    audioBase64: string;
    mimeType: string;
}

/** Flash over Pro for the same reason as image generation: cost, at a quality
 * gap that hasn't been measured to matter for reading a recipe step aloud. */
const DEFAULT_TTS_MODEL: NonNullable<SynthesizeSpeechOptions["model"]> =
    "gemini-2.5-flash-preview-tts";

/** "Firm" in Google's voice list — clear and unhurried, which reads well for
 * step-by-step instructions rather than conversation. */
const DEFAULT_VOICE = "Kore";

/**
 * `gemini-2.5-flash-preview-tts` is a preview model and throws a genuine, if
 * infrequent, `INTERNAL` 500 under normal-looking requests — reproduced with
 * an identical request retried seconds later succeeding both via a raw REST
 * call and a fresh SDK call. Google's own error message says "please retry",
 * so this does, rather than surfacing a real backend outage for what is
 * usually a single flaky attempt.
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (error: unknown): boolean =>
    error instanceof ApiError && error.status >= 500;

export async function synthesizeSpeech(
    options: SynthesizeSpeechOptions
): Promise<SynthesizedSpeech> {
    const {
        text,
        voiceName = DEFAULT_VOICE,
        model = DEFAULT_TTS_MODEL,
    } = options;

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await synthesizeOnce({ text, voiceName, model });
        } catch (error) {
            lastError = error;

            if (attempt === MAX_ATTEMPTS || !isRetryable(error)) throw error;

            console.warn(
                `[Speech] Gemini TTS attempt ${attempt} failed, retrying:`,
                error instanceof Error ? error.message : error
            );
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }

    // Unreachable — the loop above always returns or throws — but satisfies
    // the compiler's control-flow analysis without an `as` cast.
    throw lastError;
}

async function synthesizeOnce(
    options: Required<SynthesizeSpeechOptions>
): Promise<SynthesizedSpeech> {
    const { text, voiceName, model } = options;

    const response = await genai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
        },
    });

    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.find((p) => p.inlineData);

    if (!part?.inlineData?.data) {
        throw new Error("No audio returned from Gemini TTS");
    }

    const pcmMimeType = part.inlineData.mimeType ?? "audio/L16;rate=24000";

    return {
        audioBase64: pcmToWav(
            part.inlineData.data,
            parsePcmMimeType(pcmMimeType)
        ),
        mimeType: "audio/wav",
    };
}
