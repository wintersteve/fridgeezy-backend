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

export async function generateImage(
    options: GenerateImageOptions
): Promise<GeneratedImage> {
    const {
        prompt,
        model = "gemini-3-pro-image-preview",
        aspectRatio,
    } = options;

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
