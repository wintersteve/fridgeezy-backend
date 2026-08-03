// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * One representative dish per cuisine, keyed by the *curated spelling* — the
 * client builds each tile's URL as `cuisine_images/<label>.png` from its own
 * TOP_CUISINES list, so these keys and that list have to agree exactly.
 *
 * Greek is generated but never rendered: TOP_CUISINES has no Greek entry. Kept
 * so the tile is one config line away rather than one image generation away.
 */
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

/**
 * Shares its style contract with the recipe hero images
 * (`buildFoodIllustrationStyle`) because the two render on the same screen —
 * the home feed stacks recipe cards directly above the cuisine tiles. Keeping
 * two copies is exactly how these drifted apart before: this prompt held the
 * palette hex codes while the recipe one had decayed to "soft peach" in words.
 *
 * The subject half is deliberately *not* the recipe prompt's. These are browse
 * tiles roughly 110px tall on a phone, where a Michelin plate's micro-herbs,
 * sauce dots and generous negative space resolve to nothing — the tile has to
 * read as "Thai food" at a glance, so it asks for the iconic form of the dish,
 * filling the frame, rather than a restrained chef's portion.
 */
const buildPrompt = (name: string) =>
    `Editorial food illustration of ${name}, the single most recognisable dish of its cuisine.

SUBJECT
- Show ${name} in its iconic, immediately readable form — the silhouette someone would recognise at a glance, at thumbnail size.
- A generous, appetising portion that fills the vessel. Bold, simple shapes and clear colour blocking; skip fine detail that would disappear when the image is shown small.
- Every ingredient the dish is known for stays present, identifiable and in its own natural colour.
- Beautifully composed and freshly finished, but not fussy: no scattered micro-garnish, no delicate sauce dotting.

${buildFoodIllustrationStyle({
    // These tiles are cropped far harder than a recipe hero — the client lays
    // the square image out 260px tall inside a 110px card with overflow hidden,
    // so a plate floating in a wide margin would leave the tile mostly empty
    // background. Fill the frame instead of centring with air around it.
    framing:
        "the vessel is centred and fills the frame edge to edge, leaving only a slim, even margin of background — the food must still dominate when the image is cropped to a narrow strip or a small square.",
    mood: "warm, inviting and unmistakably of its cuisine — appetising at a glance.",
})}`;

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
