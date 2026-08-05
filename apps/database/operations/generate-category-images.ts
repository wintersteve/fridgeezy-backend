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
/**
 * The meal each cuisine is shown as, keyed by the *curated spelling* — the
 * client builds each tile's URL as `cuisine_images/<label>.png` from its own
 * TOP_CUISINES list, so these keys and that list have to agree exactly.
 *
 * These are *spreads*, not single dishes, and that is the change of 2026-08-05.
 * A tile showing one plate says "tacos"; a tile showing a table says "Mexican".
 * The first entry in each list becomes the dominant vessel and is what someone
 * actually recognises at 110pt, so it should be the cuisine's most legible
 * dish — the rest are fragments entering from the edges.
 *
 * Greek is generated but never rendered: TOP_CUISINES has no Greek entry. Kept
 * so the tile is one config line away rather than one image generation away.
 */
const CUISINES = {
    Italian:
        "a bowl of pasta, a caprese salad, olives, focaccia and grated parmesan",
    Chinese:
        "steamed dumplings, stir-fried greens, fried rice, chilli oil and pickled cucumber",
    Japanese:
        "nigiri sushi, miso soup, edamame, pickled vegetables and steamed rice",
    Indian: "a curry, dal, steamed rice, naan and a small dish of chutney",
    Mexican: "tacos, guacamole, red salsa, black beans and lime wedges",
    French:
        "coq au vin, gratin potatoes, a green salad, baguette and a dish of butter",
    Thai: "a green curry, pad thai, jasmine rice, fresh herbs and lime wedges",
    Spanish: "paella, patatas bravas, olives, jamón and pan con tomate",
    Greek: "a gyro, tzatziki, a Greek salad, olives and warm pita",
    Korean:
        "bibimbap, kimchi, japchae, grilled pork belly and small dishes of banchan",
};

/**
 * Shares its style contract with the recipe hero images
 * (`buildFoodIllustrationStyle`) because the two render on the same screen —
 * the home feed stacks recipe cards directly above the cuisine tiles. Keeping
 * two copies is exactly how these drifted apart before: this prompt held the
 * palette hex codes while the recipe one had decayed to "soft peach" in words.
 *
 * ## Why a table rather than a dish
 *
 * The subject half is deliberately not the recipe prompt's. These are browse
 * tiles ~110pt square on a phone, where a Michelin plate's micro-herbs, sauce
 * dots and negative space resolve to nothing. It asks for several dishes seen
 * from above, one dominant and the rest cropped by the frame.
 *
 * ## Why it is written the way it is
 *
 * Measured over 24 renders on 2026-08-05, across eight compositions and three
 * cuisines. The finding, which cost most of those renders to arrive at:
 *
 * **Describe ONE object and the model frames it, centred, in a wide margin.
 * Describe SEVERAL things and where each meets an edge, and it fills the
 * frame.** A single hero dish, a divided bento tray and an overlapping cluster
 * all failed the same way — each is one object, however many parts it has. The
 * three that filled the square all named separate vessels and said which edges
 * cut them.
 *
 * So the wording below is load-bearing in two places, and neither is decoration:
 * the vessels are named as *different geometries* (a tray beside a square dish
 * beside a round bowl is what stops a tile reading as a grid of circles), and
 * being cropped is stated as correct rather than tolerated. Softening either
 * brings the margin straight back.
 *
 * The label pill is the other constraint: the client lays a white badge across
 * the upper third of every tile, so the dominant dish is asked to sit low.
 *
 * **Say that as composition, never as a description of the badge.** The first
 * version of this prompt explained the overlay — "a white label pill is
 * overlaid across the upper third in the app" — and the model drew one: a
 * literal white rounded rectangle, floating over the Italian tile. It is the
 * same failure the trailer already guards against for the hex codes, which is
 * why that clause says they are instructions rather than things to depict.
 * Anything describing the app's own chrome will eventually be painted.
 */
/** Re-roll assets that already exist. Off by default — see the skip below. */
const force = process.argv.includes("--force");

const buildPrompt = (spread: string) =>
    `Editorial food illustration of ${spread}, seen from directly above, with one dish dominant.

SUBJECT
- ONE large vessel occupies most of the frame, placed off-centre and low, holding the first dish listed. It is the one someone should recognise at a glance.
- Around it, only FRAGMENTS of other vessels enter from the edges — the corner of a rectangular platter, the rim of a small bowl, a sliver of a square dish. None of them is more than a third visible.
- The vessels are deliberately different geometries — a long rectangular platter, a square dish with rounded corners, a shallow oval bowl, a small round bowl. Not all circles. Same matte cream ceramic throughout.
- Bold shapes and clear colour blocking; skip fine detail that disappears when the image is shown at thumbnail size.
- Every dish keeps its own natural colour, and the food is identifiable as this cuisine's.

${buildFoodIllustrationStyle({
    // The one call site that looks straight down. See `camera` on the builder
    // for the trade this accepts against the recipe cards above it in the feed.
    camera: "overhead",
    framing:
        "the dominant vessel is cropped by the bottom edge and the fragments are cropped by the sides and top, so no vessel in the image is complete and colour reaches every edge. Being cut off by the frame is correct and wanted, not a fault. The upper third of the frame carries only background or the quiet edge of a fragment — never the dominant dish.",
    renderingEmphasis:
        "Detail heaviest in the dominant dish; the fragments carry colour rather than detail.",
    mood: "editorial and confident — one dish, and the rest of the table implied.",
})}`;

async function generateAndUploadCategoryImage(
    cuisine: string,
    spread: string
): Promise<
    | { cuisine: string; url: string }
    | { cuisine: string; error: string }
    | { cuisine: string; skipped: true }
> {
    try {
        const path = `${cuisine.toLowerCase()}.png`;

        // Skip what is already there unless --force. These are *curated*
        // generations: the ones in the bucket were chosen from candidates, and
        // re-rolling gives a different picture for the same prompt, so a
        // routine re-run must not silently replace art someone picked.
        // `generateAndUploadRecipeImage` short-circuits for the same reason.
        if (!force) {
            const { data: existing } = await supabaseAdmin.storage
                .from("cuisine_images")
                .list("", { search: path });

            if (existing?.some((file) => file.name === path)) {
                console.log(`· ${cuisine} — already present, skipping`);
                return { cuisine, skipped: true };
            }
        }

        console.log(`Generating ${cuisine} tile...`);

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(spread),
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
                `Model returned no image data for ${cuisine} — the prompt likely produced a text response.`
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

    for (const [cuisine, spread] of cuisineEntries) {
        const result = await generateAndUploadCategoryImage(cuisine, spread);
        results.push(result);

        // Add a small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("\n=== Generation Summary ===\n");

    const successful = results.filter((r) => "url" in r);
    const skipped = results.filter((r) => "skipped" in r);
    const failed = results.filter((r) => "error" in r);

    console.log(
        `✓ generated ${successful.length}  ·  skipped ${skipped.length}  ·  failed ${failed.length}`
    );
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
