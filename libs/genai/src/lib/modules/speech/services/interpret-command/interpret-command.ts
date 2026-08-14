import { Type } from "@google/genai";

import { genai } from "../../../client";

export interface InterpretCommandOptions {
    /** Base64-encoded audio of one short utterance. */
    audioBase64: string;
    mimeType: string;
    /** The step the cook is looking at, for resolving "this" and "that". */
    stepText?: string;
    model?: string;
}

export interface InterpretedCommand {
    action: "next" | "back" | "repeat" | "timer" | "question" | "stop" | "unknown";
    seconds: number | null;
    question: string | null;
    transcript: string;
}

/**
 * Flash, not Pro: this is a classification into seven buckets from a few
 * seconds of audio, and it sits in the middle of a cook — latency is the
 * quality that matters, and it is the one Pro is worse at.
 *
 * **Aliased rather than pinned, unlike the TTS and image models.** Google
 * retires model ids out from under callers — `gemini-2.5-flash` began
 * answering *"no longer available to new users"* with a 404, which surfaces
 * here as a dead microphone button. A pin is worth its maintenance where the
 * exact model is part of the output (a changed TTS voice is jarring, a changed
 * image model breaks the art direction); for a classifier held to a tight
 * prompt and a strict schema, drift is cheap and an outage is not. Pin only if
 * a specific version ever proves better at kitchen noise.
 */
const DEFAULT_MODEL = "gemini-flash-latest";

/**
 * A flat object rather than a discriminated union. Gemini's structured output
 * has no union support, so the shape a union would express is enforced in the
 * prompt and re-checked by the Zod schema at the route.
 */
const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        action: {
            type: Type.STRING,
            enum: [
                "next",
                "back",
                "repeat",
                "timer",
                "question",
                "stop",
                "unknown",
            ],
        },
        seconds: { type: Type.INTEGER, nullable: true },
        question: { type: Type.STRING, nullable: true },
        transcript: { type: Type.STRING },
    },
    required: ["action", "seconds", "question", "transcript"],
} as const;

const systemPrompt = (stepText?: string): string => `
You are the ear of a hands-free cooking assistant. You receive a few seconds of
audio recorded in a kitchen and classify it into exactly one action.

Actions:
- "next": move to the following step ("next", "done", "got it", "carry on")
- "back": return to the previous step ("go back", "previous", "what was the last one")
- "repeat": say the current step again ("repeat that", "say that again", "what?")
- "timer": start a timer. Put the duration in "seconds".
  ("set a timer for ten minutes" -> 600, "give me ninety seconds" -> 90)
- "stop": stop talking / stop the assistant ("stop", "be quiet", "cancel")
- "question": anything the cook is ASKING about the dish. Put the question,
  rewritten as a clear standalone sentence, in "question".
  ("how much garlic was it again" -> "How much garlic does this recipe need?")
- "unknown": you could not make out a clear instruction.

Rules:
- A kitchen is noisy and the microphone will pick up extractor fans, running
  water, other people talking and the radio. When the audio does not contain a
  clear instruction aimed at you, return "unknown". Do NOT guess. A wrong
  "next" loses the cook their place with their hands full, which is worse than
  asking them to repeat themselves.
- Only "timer" may set "seconds"; only "question" may set "question". Every
  other action sets both to null.
- "transcript" is always what you actually heard, verbatim, even for "unknown".
  Leave it as an empty string if there was no speech at all.
${stepText ? `\nThe cook is currently looking at this step, so resolve "this", "that" and "it" against it:\n"""\n${stepText}\n"""` : ""}
`.trim();

/**
 * Classify a spoken kitchen utterance. Audio goes to Gemini inline — these are
 * a few seconds long, so the Files API's upload round trip would cost more than
 * the bytes save.
 */
export async function interpretCommand(
    options: InterpretCommandOptions
): Promise<InterpretedCommand> {
    const {
        audioBase64,
        mimeType,
        stepText,
        model = DEFAULT_MODEL,
    } = options;

    const response = await genai.models.generateContent({
        model,
        contents: [
            {
                role: "user",
                parts: [
                    { inlineData: { mimeType, data: audioBase64 } },
                    { text: "Classify this utterance." },
                ],
            },
        ],
        config: {
            systemInstruction: systemPrompt(stepText),
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            // Nothing here benefits from deliberation, and every token of it
            // is latency the cook waits through with a raised hand. Kept as a
            // request rather than a guarantee: Gemini 3 models ignore it and
            // think anyway (measured ~80 thought tokens on a silent probe),
            // and `thinkingLevel` is not a field this API version accepts.
            thinkingConfig: { thinkingBudget: 0 },
        },
    });

    const text = response.text;

    if (!text) throw new Error("No response from Gemini command interpreter");

    const parsed = JSON.parse(text) as InterpretedCommand;

    return {
        action: parsed.action ?? "unknown",
        seconds: parsed.action === "timer" ? (parsed.seconds ?? null) : null,
        question: parsed.action === "question" ? (parsed.question ?? null) : null,
        transcript: parsed.transcript ?? "",
    };
}
