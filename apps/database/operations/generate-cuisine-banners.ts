// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

const BUCKET = "cuisine_banners";

/**
 * The hero dish and the loose ingredients trailing away from it, per cuisine.
 *
 * Keyed by the *curated spelling*, because the client builds each banner's URL
 * as `cuisine_banners/<label>.png` from its own TOP_CUISINES list — these keys,
 * that list and `CUISINE_BLURBS` all have to agree.
 *
 * `bits` matters as much as `hero`. They are the trail, so they have to be
 * things that read at a glance as single objects: a lime wedge, a chilli, a
 * sprig. Anything amorphous — a sauce, a powder, a scatter of seeds — draws as
 * a smudge at banner scale and the trail stops reading as ingredients.
 */
const CUISINES = {
    Italian: {
        hero: "a bowl of spaghetti with tomato, basil and parmesan",
        bits: "basil sprigs, vine tomatoes, a wedge of parmesan and whole garlic cloves",
    },
    French: {
        hero: "a shallow bowl of coq au vin",
        bits: "thyme sprigs, bay leaves, button mushrooms and a torn piece of baguette",
    },
    Chinese: {
        hero: "a plate of steamed dumplings",
        bits: "spring onions, star anise, dried red chillies and a small dish of chilli oil",
    },
    Japanese: {
        hero: "a plate of nigiri sushi",
        bits: "pickled ginger, edamame pods, a mound of wasabi and a pair of chopsticks",
    },
    Indian: {
        hero: "a bowl of curry",
        bits: "coriander sprigs, green chillies, cardamom pods and a torn piece of naan",
    },
    Thai: {
        hero: "a bowl of green curry",
        bits: "Thai basil sprigs, lime wedges, red chillies and lemongrass stalks",
    },
    Mexican: {
        hero: "a plate of tacos",
        bits: "lime wedges, coriander sprigs, sliced radishes and whole red chillies",
    },
    Spanish: {
        hero: "a pan of paella",
        bits: "lemon wedges, parsley sprigs, green olives and whole prawns",
    },
    Korean: {
        hero: "a bowl of bibimbap",
        bits: "kimchi, spring onions, sesame seeds and a small dish of gochujang",
    },
};

/**
 * The banner prompt: a hero at the right, ingredients trailing away from it.
 *
 * ## Why the left has to come back empty
 *
 * The card lays the cuisine's name, a line of copy and a button over the left
 * of this image, and there is **no scrim** — these illustrations are high-key by
 * art direction ("every value in the upper, lighter half of the range"), so
 * darkening one to float text on it is the single thing guaranteed to fight the
 * palette. The clear area is composed, not added afterwards.
 *
 * ## Why it is worded as objects rather than as framing
 *
 * Measured repeatedly across this project: an instruction aimed at the camera or
 * the crop ("push in", "leave space at the left", "fill the frame") does not
 * survive, while a statement about where the *objects* are does. So the rule
 * below is "no vessel, no ingredient, no shadow falls there" — a fact about the
 * scene — and not "keep the left clear", which is a fact about the picture.
 *
 * ## The trade this composition carries
 *
 * The trail runs diagonally down toward the bottom-left, which is where the
 * Explore button sits. It was chosen with that known. If the button ever reads
 * as sitting on top of the ingredients, the fix is to move the trail into the
 * upper half rather than to scrim the lower one.
 */
const buildPrompt = ({ hero, bits }: (typeof CUISINES)[keyof typeof CUISINES]) =>
    `Editorial food illustration of ${hero} with ${bits}, seen from above.

SUBJECT
- The bowl sits at the right edge of the frame, cropped by it.
- A loose diagonal trail of the ingredients runs down and to the left from the bowl, a few pieces at a time, thinning as it goes and stopping well before the left edge.
- The trail is sparse: single leaves, single wedges, well apart, never a cluster and never a line.
- The left third of the frame is bare background: no vessel, no ingredient, no garnish and no shadow falls there.

${buildFoodIllustrationStyle({
    // The banners look straight down, like the cuisine tiles — see `camera` on
    // the builder for the trade that accepts against the recipe cards.
    camera: "overhead",
    framing:
        "the bowl is cropped by the right edge; the trail of ingredients crosses the lower middle diagonally and thins to nothing before the left edge. The upper-left of the frame is unbroken background.",
    renderingEmphasis:
        "Detail heaviest at the bowl and lightest along the trail, so the eye travels right.",
    mood: "quiet and deliberate — ingredients on their way to a dish.",
})}`;

/**
 * Skip anything already in the bucket unless `--force`.
 *
 * These are curated generations: re-rolling gives a different picture for the
 * same prompt, so a routine re-run must not silently replace art someone chose.
 * `generateAndUploadRecipeImage` short-circuits for the same reason.
 */
const force = process.argv.includes("--force");

async function generateAndUpload(
    cuisine: string,
    spec: (typeof CUISINES)[keyof typeof CUISINES]
): Promise<"skipped" | "ok" | "failed"> {
    const path = `${cuisine.toLowerCase()}.png`;

    try {
        if (!force) {
            const { data: existing } = await supabaseAdmin.storage
                .from(BUCKET)
                .list("", { search: path });

            if (existing?.some((file) => file.name === path)) {
                console.log(`· ${cuisine} — already present, skipping`);
                return "skipped";
            }
        }

        console.log(`Generating ${cuisine} banner...`);

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(spec),
            numberOfImages: 1,
            // The card is 1.9:1 and this is the widest ratio the model offers,
            // so the crop takes a sliver off the top and bottom rather than off
            // the sides — where the dish and the clear area both live.
            aspectRatio: "16:9",
        });

        // The model sometimes answers with text and no image at all; passing
        // that to Buffer.from() raises an opaque TypeError instead of saying so.
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

    console.log("=== Explore-Cuisine Banner Generation ===\n");
    console.log(`Bucket: ${BUCKET}`);
    console.log(`${entries.length} banners at 16:9.`);
    console.log(
        force
            ? "--force: existing banners WILL be regenerated and overwritten.\n"
            : "Existing banners are skipped. Pass --force to re-roll them.\n"
    );

    const results = [];

    for (const [cuisine, spec] of entries) {
        results.push(await generateAndUpload(cuisine, spec));
        // Same spacing as the other image operations — enough to stay clear of
        // the image API's rate limit on a back-to-back run.
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
