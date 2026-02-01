import { generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Normalizes a recipe name to create a safe filename for storage.
 * Removes diacritics and special characters, replacing them with ASCII equivalents.
 */
const normalizeFileName = (name: string): string => {
    return name
        .normalize("NFD") // Decompose combined characters into base + diacritics
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric chars with underscore
        .replace(/^_+|_+$/g, ""); // Trim leading/trailing underscores
};

const buildPrompt = (
    name: string
) => `An illustrated, bird's-eye (top-down) view of a ${name}, presented simply and elegantly.

The dish is centered on a clean, neutral plate with subtle handmade ceramic texture. No utensils, no background props, no clutter — the entire focus is on the food itself.

Illustration style: refined, modern editorial food illustration with soft hand-drawn details; minimalistic but warm; not photorealistic.

Color palette: warm, natural tones aligned with a soft culinary app aesthetic — soft peach, sage green, creamy off-white, muted beige and warm stone tones. Avoid harsh blacks; use deep charcoal only for subtle linework or contrast.

Lighting and shading: gentle, diffuse light with soft shadows; calm, inviting atmosphere.

Background: solid or lightly textured warm cream background, flat and unobtrusive.

Composition: perfectly centered, balanced, and spacious, suitable for a recipe app hero image.

Mood: authentic, comforting, artisanal, and timeless — evokes home cooking and cultural tradition without stereotypes.

IMPORTANT: Generate only the illustration. Do not include any text, labels, codes, or annotations in the image.`;

export async function generateAndUploadRecipeImage(
    name: string
): Promise<string> {
    try {
        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(name),
            numberOfImages: 1,
            aspectRatio: "3:4",
        });

        if (!base64Data) {
            console.error("No image data received from generateImage");
            return ""; // Return empty string if no image data
        }

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, "base64");

        // Determine file extension based on mime type
        const extension = mimeType === "image/jpeg" ? "jpg" : "png";
        const fileName = `${normalizeFileName(name)}.${extension}`;
        const filePath = `${fileName}`;

        // Upload to Supabase storage
        const { error } = await supabaseAdmin.storage
            .from("recipes")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) {
            console.error("Failed to upload recipe image:", error);
            return ""; // Return empty string on upload error
        }

        // Get public URL
        const { data } = supabaseAdmin.storage
            .from("recipes")
            .getPublicUrl(filePath);

        return data.publicUrl;
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        return ""; // Return empty string on error
    }
}
