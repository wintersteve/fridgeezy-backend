import { genai } from "../../../client";

export interface GenerateImageOptions {
    prompt: string;
    numberOfImages?: number;
    aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
}

export interface GeneratedImage {
    base64Data: string;
    mimeType: string;
}

/**
 * Generate an image using Google's Imagen model
 */
export async function generateImage(
    options: GenerateImageOptions
): Promise<GeneratedImage> {
    const { prompt, numberOfImages = 1, aspectRatio = "1:1" } = options;

    try {
        const response = await genai.models.generateImages({
            model: "imagen-3.0-generate-001",
            prompt,
            config: {
                numberOfImages,
                aspectRatio,
            },
        });

        // Extract the first image from the response
        if (response.generatedImages && response.generatedImages.length > 0) {
            const generatedImage = response.generatedImages[0];

            if (generatedImage.image?.imageBytes) {
                return {
                    base64Data: generatedImage.image.imageBytes,
                    mimeType: generatedImage.image.mimeType || "image/png",
                };
            }

            // Check for filtered reasons
            if (generatedImage.raiFilteredReason) {
                throw new Error(
                    `Image generation filtered: ${generatedImage.raiFilteredReason}`
                );
            }
        }

        throw new Error("No image data received from Imagen API");
    } catch (error) {
        console.error("Image generation failed:", error);
        throw new Error(
            `Failed to generate image: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}
