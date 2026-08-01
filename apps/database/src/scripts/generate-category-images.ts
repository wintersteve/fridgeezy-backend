// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

const CUISINES = {
    Italian: "Pizza",
    Chinese: "Fried Rice",
    Japanese: "Sushi",
    Indian: "Butter Chicken",
    Mexican: "Tacos",
    French: "Croissant",
    Thai: "Pad Thai",
    Spanish: "Paella",
    Greek: "Gyro",
    Korean: "Bibimbap",
};
const buildPrompt = (name: string) =>
    `An illustrated, bird’s-eye (top-down) view of ${name}, presented simply and elegantly. The dish is centered on a clean, neutral plate with subtle handmade ceramic texture. No utensils, no background props, no clutter — the entire focus is on the food itself. Illustration style: refined, modern editorial food illustration with soft hand-drawn details; minimalistic but warm; not photorealistic. Color palette: warm, natural tones including peach (#F4A67A), sage green (#93C5A8), creamy off-white (#FFF5EE), and muted beige and stone tones (#FDFBF9, #FAF8F6). Use deep charcoal (#060606) only for subtle linework or contrast. Lighting and shading: gentle, diffuse light with soft shadows; calm, inviting atmosphere. Background: solid or lightly textured off-white/cream background (#FDFBF9 or #FAF8F6), flat and unobtrusive. Composition: perfectly centered, balanced, and spacious, suitable for a recipe app hero image.`;

async function generateAndUploadCategoryImage(
    cuisine: string,
    dishName: string
): Promise<
    { cuisine: string; url: string } | { cuisine: string; error: string }
> {
    try {
        console.log(`Generating image for ${cuisine} cuisine (${dishName})...`);

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(dishName),
            numberOfImages: 1,
            aspectRatio: "1:1",
        });

        // base64Data is optional: the model sometimes answers a prompt with text
        // and no image at all. Passing that straight to Buffer.from() raised an
        // opaque TypeError about the argument type instead of saying what went
        // wrong — and went unnoticed because this file lived in tools/, which
        // tsconfig.app.json never included.
        if (!base64Data) {
            throw new Error(
                `Model returned no image data for ${cuisine} (${dishName}) — the prompt likely produced a text response.`
            );
        }

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, "base64");

        // Determine file extension based on mime type
        const extension = mimeType === "image/jpeg" ? "jpg" : "png";
        const fileName = `${cuisine.toLowerCase()}.${extension}`;
        const filePath = `${fileName}`;

        console.log(`Uploading ${fileName} to Supabase storage...`);

        // Upload to Supabase storage
        const { error } = await supabaseAdmin.storage
            .from("cuisine_images")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) {
            console.error(`Failed to upload ${cuisine} image:`, error);
            return { cuisine, error: error.message };
        }

        // Get public URL
        const { data } = supabaseAdmin.storage
            .from("cuisine_images")
            .getPublicUrl(filePath);

        console.log(`✓ Successfully generated and uploaded ${cuisine} image`);
        console.log(`  URL: ${data.publicUrl}\n`);

        return { cuisine, url: data.publicUrl };
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to generate ${cuisine} image:`, errorMessage);
        return { cuisine, error: errorMessage };
    }
}

async function main() {
    const cuisineEntries = Object.entries(CUISINES);

    console.log("=== Category Image Generation Tool ===\n");
    console.log(`Generating images for ${cuisineEntries.length} cuisines:\n`);

    const results = [];

    for (const [cuisine, dishName] of cuisineEntries) {
        const result = await generateAndUploadCategoryImage(cuisine, dishName);
        results.push(result);

        // Add a small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("\n=== Generation Summary ===\n");

    const successful = results.filter((r) => "url" in r);
    const failed = results.filter((r) => "error" in r);

    console.log(`✓ Successful: ${successful.length}/${cuisineEntries.length}`);
    if (successful.length > 0) {
        successful.forEach((r) => {
            if ("url" in r) {
                console.log(`  - ${r.cuisine}: ${r.url}`);
            }
        });
    }

    if (failed.length > 0) {
        console.log(`\n✗ Failed: ${failed.length}/${cuisineEntries.length}`);
        failed.forEach((r) => {
            if ("error" in r) {
                console.log(`  - ${r.cuisine}: ${r.error}`);
            }
        });
    }

    console.log("\nGeneration complete!");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
