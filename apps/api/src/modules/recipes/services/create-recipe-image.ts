import { generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

const buildPrompt = (
    name: string
) => `An illustrated, bird’s-eye (top-down) view of a ${name}, presented simply and elegantly.

The dish is centered on a clean, neutral plate with subtle handmade ceramic texture. No utensils, no background props, no clutter — the entire focus is on the food itself.

Illustration style: refined, modern editorial food illustration with soft hand-drawn details; minimalistic but warm; not photorealistic.

Color palette: warm, natural tones aligned with a soft culinary app aesthetic — peach (#F4A67A), sage green (#93C5A8), creamy off-white (#FFF5EE), muted beige and stone tones (#FDFBF9, #FAF8F6). Avoid harsh blacks; use deep charcoal (#060606) only for subtle linework or contrast.

Lighting and shading: gentle, diffuse light with soft shadows; calm, inviting atmosphere.

Background: solid or lightly textured off-white/cream background (#FDFBF9 or #FAF8F6), flat and unobtrusive.

Composition: perfectly centered, balanced, and spacious, suitable for a recipe app hero image.

Mood: authentic, comforting, artisanal, and timeless — evokes home cooking and cultural tradition without stereotypes.`;

export async function generateAndUploadRecipeImage(
    name: string
): Promise<void> {
    try {
        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(name),
            numberOfImages: 1,
            aspectRatio: "3:4",
        });

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, "base64");

        // Determine file extension based on mime type
        const extension = mimeType === "image/jpeg" ? "jpg" : "png";
        const fileName = `${name.toLowerCase().replace(/\s+/g, "_")}.${extension}`;
        const filePath = `${fileName}`;

        // Upload to Supabase storage
        const { error } = await supabaseAdmin.storage
            .from("category_images")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) {
            console.error("Failed to upload recipe image:", error);
        }
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        // Don't throw - we don't want to break the recipe generation if image generation fails
    }
}
