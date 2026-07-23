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

// A recipe's image always lives at this single, deterministic path (one
// extension), so its public URL can be computed from the name alone \u2014 no
// storage lookup, and no need to await generation before knowing the URL.
const imageStoragePath = (name: string): string =>
    `${normalizeFileName(name)}.png`;

/**
 * The deterministic public URL a recipe's image will live at, derived purely
 * from its name. Valid to store BEFORE generation finishes uploading \u2014 the URL
 * resolves once the (async) upload lands. Lets persistence set `image_url`
 * without blocking on, or re-triggering, image generation.
 */
export const getRecipeImagePublicUrl = (name: string): string =>
    supabaseAdmin.storage.from("recipes").getPublicUrl(imageStoragePath(name))
        .data.publicUrl;

const buildPrompt = (
    name: string
) => `An illustrated, bird's-eye (top-down) view of ${name}, presented simply and elegantly in its most natural serving vessel — whether that's a plate, bowl, jar, glass, or any other appropriate container for this type of food.

The food is centered in its proper serving context with subtle handmade ceramic or artisanal texture. No utensils, no background props, no clutter — the entire focus is on the food itself.

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
        const filePath = imageStoragePath(name);

        // Reuse an existing image for this dish name if we already have one.
        const { data: existingFile } = await supabaseAdmin.storage
            .from("recipes")
            .list("", { search: filePath });

        if (existingFile?.some((file) => file.name === filePath)) {
            return getRecipeImagePublicUrl(name);
        }

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

        // Always store at the single deterministic path (the content type still
        // reflects the real bytes, which is what clients render by).
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

        return getRecipeImagePublicUrl(name);
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        return ""; // Return empty string on error
    }
}
