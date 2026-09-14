import { genai } from "../../../client";

// Extended config to include parameters not yet in SDK types
export interface GenerateImageOptions {
    prompt: string;
    numberOfImages?: number;
    aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
    imageSize?: "1K" | "2K" | "4K";
    model?:
        | "imagen-4.0-generate-001"
        | "gemini-3-pro-image"
        | "gemini-3.1-flash-image"
        | "gemini-2.5-flash-image";
}

export interface GeneratedImage {
    base64Data?: string;
    mimeType: string;
}

/**
 * Default image model: Nano Banana 2, set 2026-09-13 on the owner's call.
 *
 * **It is untested against this art direction as of that date, and the sweep
 * below does not cover it.** Treat the note as history, not as a verdict.
 *
 * ## What the 2026-08-04 blind A/B found, and why it no longer governs
 *
 * Five dishes, models unlabelled: Pro was rated YES under both surviving
 * prompts, Flash 2.5 came in GOOD and MEH, and Flash was shipped anyway because
 * the gap did not justify 3.6x. Imagen 4 and OpenAI's gpt-image-1 were in the
 * same sweep and both lost — Imagen 4 put people in frame instead of food;
 * gpt-image-1 shifted the palette and only offers 2:3, not our 3:4.
 *
 * That result is now detached from the prompt it was measured on. The
 * rendering-medium line was rewritten on 2026-08-19 ("causes, not adjectives",
 * 18 renders) specifically to correct Flash 2.5 rendering this style flat and
 * hard-outlined, and it worked. So the A/B ranked models under a prompt that no
 * longer ships, and **a fresh comparison is the only thing that settles which
 * model is best here.**
 *
 * ## What the 2026-09-13 three-dish check found
 *
 * Comparing Pro against Flash 2.5 on identical prompts: mean subject saturation
 * was effectively identical (0.369 vs 0.352), but the GROUND diverged — Flash
 * paints ~#F7F2E0 (R-B 22), Pro ~#FBF7EE (R-B 13-17) against a spec of #FDFBF9.
 * Pro is the more faithful; Flash drifts warm. The app's page ground #FCFAF6 was
 * derived from Flash's warmth, so Pro's colder field made the same food read as
 * more saturated and less appetising.
 *
 * **So ground temperature is the axis to watch on any model swap here**, ahead
 * of saturation. If a new model's output reads cold, warm `ground` rather than
 * touching the palette — that line pins hue on purpose, and widening it is what
 * produced the peach-shard tiramisu on record in `art-direction`.
 *
 * ## Cost
 *
 * ~$0.067/1K image, against Pro's ~$0.13 and Flash 2.5's ~$0.039. Bounded per
 * *dish* rather than per view — `generateAndUploadRecipeImage` short-circuits on
 * an existing object at the deterministic storage path, so a dish renders once,
 * ever. At ~150 new dishes/month the spread across all three is a few dollars;
 * at 10,000 it is the difference between ~$400 and ~$1,400 a month.
 *
 * Every id here is overridable via GENAI_IMAGE_MODEL with no deploy, which is
 * how a comparison gets run. `gemini-2.5-flash-image` is the cheap fallback and
 * the variant the current prompt is tuned for, but note that Google now flags it
 * legacy, so it is on a clock.
 */
const DEFAULT_IMAGE_MODEL: NonNullable<GenerateImageOptions["model"]> =
    (process.env.GENAI_IMAGE_MODEL as GenerateImageOptions["model"]) ??
    "gemini-3.1-flash-image";

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
