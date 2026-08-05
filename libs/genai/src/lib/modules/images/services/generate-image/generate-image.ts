import { genai } from "../../../client";

// Extended config to include parameters not yet in SDK types
export interface GenerateImageOptions {
    prompt: string;
    numberOfImages?: number;
    aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
    imageSize?: "1K" | "2K" | "4K";
    model?:
        | "imagen-4.0-generate-001"
        | "gemini-3-pro-image-preview"
        | "gemini-2.5-flash-image";
}

export interface GeneratedImage {
    base64Data?: string;
    mimeType: string;
}

/**
 * Default image model. Flash at ~$0.039/image against Pro's ~$0.14 — a
 * deliberate cost choice made with the quality gap measured, not assumed.
 *
 * What the 2026-08-04 sweeps found, so nobody re-runs them: Pro is genuinely
 * better. In a blind head-to-head (five dishes, models unlabelled) Pro was
 * rated YES under both surviving prompts while Flash came in GOOD and MEH.
 * Flash tends to render this art direction flatter and more hard-outlined than
 * the style block describes. It was chosen anyway, at GOOD, because the gap did
 * not justify 3.6x at this catalogue's volume.
 *
 * That trade is volume-dependent, and the cost is bounded per *dish* rather
 * than per view — `generateAndUploadRecipeImage` short-circuits on an existing
 * object at the deterministic storage path, so a dish renders once, ever. At
 * ~150 new dishes/month the difference is ~$16/month and Pro is easily
 * affordable; at 10,000 it is ~$1,000/month and it is not. **Revisit this line
 * if image quality starts mattering more than image spend** — the switch is
 * GENAI_IMAGE_MODEL=gemini-3-pro-image-preview, no deploy needed, and Pro is
 * the known-better answer waiting there.
 *
 * The recipe prompt's restraint rules exist partly to hold this up: they are
 * the variant that degraded best on Flash. Loosening them makes Flash worse,
 * not just different.
 *
 * Imagen 4 and OpenAI's gpt-image-1 were in the same sweep and were both worse
 * for this style — Imagen 4 put people in frame instead of food; gpt-image-1
 * shifted the palette and only offers 2:3, not our 3:4.
 */
const DEFAULT_IMAGE_MODEL: NonNullable<GenerateImageOptions["model"]> =
    (process.env.GENAI_IMAGE_MODEL as GenerateImageOptions["model"]) ??
    "gemini-2.5-flash-image";

export async function generateImage(
    options: GenerateImageOptions
): Promise<GeneratedImage> {
    const { prompt, model = DEFAULT_IMAGE_MODEL, aspectRatio } = options;

    try {
        // Use generateContent instead of generateImages for Nano Banana models
        const response = await genai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    ...(aspectRatio && { aspectRatio }),
                },
            },
        });

        const candidate = response.candidates?.[0];
        if (!candidate || !candidate.content?.parts) {
            throw new Error("No content received from Gemini");
        }

        // Find the part that contains the image data
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                return {
                    base64Data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "image/png",
                };
            }
        }

        throw new Error(
            "Model returned text but no image data. Try refining the prompt to strictly 'Generate an image of...'"
        );
    } catch (error) {
        console.error("Image generation failed:", error);
        throw error;
    }
}
