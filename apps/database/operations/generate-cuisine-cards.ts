// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

const BUCKET = "cuisine_cards";

/**
 * The three tints these cards are painted on.
 *
 * ## The model does not reproduce a hex, and the card is built around that
 *
 * Asked for `#FBE4E1`, a render came back with corners at `#EEE4DD` — close in
 * feel, nowhere near in value. `padPngToSquare` records the same measurement
 * from the other direction: the art direction asks for a `#FDFBF9` ground and
 * output lands nearer `#F6F0E0`, which is why it replicates edge pixels rather
 * than filling with a palette token.
 *
 * So these hexes steer the *mood* of a card and nothing more. **Nothing in the
 * client may paint a matching background behind or beside one of these images**
 * — two nearly-equal creams meeting in a straight line is the most visible
 * defect available, and it is unfixable from the prompt side. The card is the
 * image, full bleed, with its copy over the empty part the composition leaves.
 *
 * Only real container tokens are used all the same: a colour mixed for an image
 * is one the client cannot name, and the pair would drift the first time either
 * side was touched.
 */
const TINTS = {
    primaryContainer: { name: "pale peach", hex: "#FFF5EE" },
    secondaryContainer: { name: "pale sage", hex: "#F0F7F2" },
    roseContainer: { name: "pale rose", hex: "#FBE4E1" },
};

/**
 * One dish and one tint per cuisine, keyed by the curated `TOP_CUISINES`
 * spelling — the same keys as `CUISINE_BLURBS` and the banner set.
 *
 * The tints cycle in threes so no two cards adjacent in the row share one. That
 * is the only reason the order matters; change the cuisine order and the tints
 * want re-dealing.
 */
const CUISINES: Record<string, { dish: string; tint: keyof typeof TINTS }> = {
    Italian: { dish: "a bowl of spaghetti al pomodoro", tint: "primaryContainer" },
    French: { dish: "a croissant and a small cup of coffee", tint: "secondaryContainer" },
    Chinese: { dish: "a bamboo steamer of dumplings", tint: "roseContainer" },
    Japanese: { dish: "a bowl of ramen", tint: "primaryContainer" },
    Indian: { dish: "a bowl of curry with naan", tint: "secondaryContainer" },
    Thai: { dish: "a bowl of pad thai", tint: "roseContainer" },
    Mexican: { dish: "a plate of tacos", tint: "primaryContainer" },
    Spanish: { dish: "a pan of paella", tint: "secondaryContainer" },
    Korean: { dish: "a bowl of bibimbap", tint: "roseContainer" },
};

/**
 * One dish sitting low in a portrait frame, with the top third left empty.
 *
 * ## The picture is the whole card
 *
 * Not a band inside one. The cuisine's name is set over the empty top third of
 * the illustration itself, the same way the Explore banner puts its copy on the
 * bare left of its picture — which is the only arrangement that cannot seam,
 * because there is only ever one surface. See `TINTS` for the measurement that
 * ruled out the alternative.
 *
 * ## Wording that is load-bearing
 *
 * "Sitting in the lower part, cropped by the bottom edge" and "the top third is
 * empty background" are both statements about where the *objects* are. That is
 * the distinction which has decided every image round in this project:
 * instructions aimed at the camera or the crop do not survive; statements about
 * the scene do.
 */
const buildPrompt = (dish: string, tint: keyof typeof TINTS) =>
    `Editorial food illustration of ${dish}.

SUBJECT
- One vessel, large and generously filled, sitting in the LOWER part of the frame and cropped by the bottom edge so its foot is not visible.
- The top third of the frame is empty background: no part of the dish, no garnish and no shadow reaches into it.
- Nothing else in the picture: no second dish, no scattered ingredients, no cutlery.
- Bold shapes and clear colour blocking; skip fine detail that disappears when the image is shown small.
- Unmistakably ${dish}: every ingredient it is known for stays present and identifiable, in its own natural colour.

${buildFoodIllustrationStyle({
    ground: TINTS[tint],
    framing:
        "the vessel fills the lower two thirds of the frame and is cut off by the bottom edge, so its foot is never visible. The top third is bare background, with no part of the dish or its shadow reaching into it — the card's title is set there.",
    renderingEmphasis:
        "Detail concentrated in the dish, which is the only object in the picture.",
    mood: "warm and inviting — one dish, offered.",
})}`;

/** Re-roll assets that already exist. Off by default — see the skip below. */
const force = process.argv.includes("--force");

async function generateAndUpload(
    cuisine: string,
    spec: { dish: string; tint: keyof typeof TINTS }
): Promise<"skipped" | "ok" | "failed"> {
    const path = `${cuisine.toLowerCase()}.png`;

    try {
        // Curated generations: re-rolling gives a different picture for the same
        // prompt, so a routine re-run must not replace art someone chose.
        if (!force) {
            const { data: existing } = await supabaseAdmin.storage
                .from(BUCKET)
                .list("", { search: path });

            if (existing?.some((file) => file.name === path)) {
                console.log(`· ${cuisine} — already present, skipping`);
                return "skipped";
            }
        }

        console.log(`Generating ${cuisine} card (${spec.tint})...`);

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(spec.dish, spec.tint),
            numberOfImages: 1,
            // The illustration IS the card, not a band inside it, so it is
            // generated at the card's own portrait shape. See the note above on
            // why there is no separate tinted background to match.
            aspectRatio: "3:4",
        });

        if (!base64Data) {
            throw new Error(
                `Model returned no image data for ${cuisine} — the prompt likely produced a text response.`
            );
        }

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, Buffer.from(base64Data, "base64"), {
                contentType: mimeType,
                upsert: true,
            });

        if (error) throw new Error(error.message);

        console.log(`✓ ${cuisine}`);
        return "ok";
    } catch (error) {
        console.error(
            `✗ ${cuisine}: ${error instanceof Error ? error.message : error}`
        );
        return "failed";
    }
}

async function main() {
    const entries = Object.entries(CUISINES);

    console.log("=== Cuisine Collection Card Generation ===\n");
    console.log(`Bucket: ${BUCKET}`);
    console.log(`${entries.length} cards at 3:4, each on its own tint.`);
    console.log(
        force
            ? "--force: existing cards WILL be regenerated and overwritten.\n"
            : "Existing cards are skipped. Pass --force to re-roll them.\n"
    );

    const results = [];

    for (const [cuisine, spec] of entries) {
        results.push(await generateAndUpload(cuisine, spec));
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const count = (value: string) =>
        results.filter((result) => result === value).length;

    console.log("\n=== Summary ===\n");
    console.log(
        `✓ generated ${count("ok")}  ·  skipped ${count("skipped")}  ·  failed ${count("failed")}`
    );

    if (count("failed") > 0) process.exitCode = 1;
}

main();
