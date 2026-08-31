// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * The client's illustrations that are not about a specific dish.
 *
 * Three locked pages — the Saved tab, the Shopping tab and the recipe generator
 * — plus the home feed's compose card. That is what they have in common and
 * what decides their subjects: every other image operation here is handed a
 * recipe, a cuisine or an ingredient and paints *that*. These have to say what
 * a whole capability is for.
 *
 * ## Two framings, and they are opposites
 *
 * The three `locked` scenes are masked into a round medallion, so anything in a
 * corner is thrown away and anything touching an edge is cut on a curve. Those
 * prompts ask for the subject centred and filling about two thirds of the frame
 * — noticeably tighter than `generate-app-icon`'s three quarters, and the
 * opposite of `generate-splash`, which had to fight the model *out* of a clean
 * centred margin because a launch screen is stretched rather than masked.
 *
 * `menu` is the other way round. It is a bleed — a rotated band down the right
 * of a card, cover-cropped and graded into the card's own ground — so a clean
 * margin there is wasted band, and the subject has to run to the edges.
 *
 * ## Why none of the three is a cooking pot
 *
 * The obvious set is bowl / shopping bag / saucepan, and two of those fall
 * outside the art direction rather than inside it: `vessel: "ceramic"` is a
 * serving vessel, not a pan, and a paper bag is a prop, which the background
 * rule spends its whole length forbidding. Fighting that would produce three
 * pictures that look like a different kitchen from the rest of the app, which
 * is the exact failure the shared style exists to prevent.
 *
 * So each subject is said in the language the style already speaks: a finished
 * bowl for the things you kept, loose produce for the shop, a plate whose
 * contents have not resolved into a dish yet for the generator, and a laid
 * table seen from above for the menu composer.
 *
 * ## `SINGLE_IMAGE_RULE` is not boilerplate
 *
 * Measured 2026-08-30: `saved` came back as a **2×2 contact sheet of four
 * different bowls**, on a prompt that already said "ONE bowl, and nothing else
 * in the picture" twice. Asking for one centred subject in a square frame with
 * an even margin describes a catalogue plate as readily as a picture, and the
 * model took the second reading. None of the other operations here hit this
 * because none of them ask for that much empty ground.
 */

/**
 * Said to every scene, because a lone subject in a wide even margin is exactly
 * the composition a model answers with a sheet of variations. See above.
 */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE subject, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, quadtych, mood board, set of variations, or a frame divided into panels or quadrants by any line, gutter or border.`;
interface Scene {
    prompt: string;
    /**
     * Composed for the shape it is DISPLAYED in, not for a house default.
     *
     * The three `locked` medallions are square because a disc is inscribed in a
     * square. `menu` is a tall band down the side of a card, and a square
     * painting cover-cropped into one shows a narrow vertical slice of itself
     * hugely magnified — measured on the first render: three dishes side by
     * side came through as one dish, filling the band. Portrait is the fix, and
     * the subject has to be arranged down the frame to match it.
     */
    aspectRatio: Parameters<typeof generateImage>[0]["aspectRatio"];
}

const SCENES: Record<string, Scene> = {
    /**
     * Saved — one finished dish, seen from above.
     *
     * Overhead because a bowl seen from directly above is concentric circles,
     * and a circle is what survives a round mask and a small render. Same
     * reasoning `generate-app-icon` records for `bowl-overhead`.
     */
    saved: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of a single ceramic bowl seen from directly above, holding one quiet, finished dish.

SUBJECT
- ONE bowl, and nothing else in the picture. It is the whole subject.
- It reads as concentric circles: the outer rim, the inner wall, and the food pooled in the middle.
- What it holds is a settled, appetising arrangement — soft folds of colour with a few clear shapes among them, and a small green herb note on top. It looks like something already made, not something being prepared.
- No table, no cutlery, no hands, no second object, no cast pattern.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the bowl is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. It is never cropped by an edge, and nothing at all sits in the corners of the frame.",
    renderingEmphasis:
        "The concentric rings of the bowl are the strongest shape in the picture and stay crisp.",
    mood: "settled and warm — a dish worth keeping.",
})}`,
    },

    /**
     * Shopping — the ingredients themselves, which is what `vessel: "none"` is
     * for. A paper bag would be a prop, and the background rule forbids props.
     */
    shopping: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of a small gathering of fresh raw ingredients, as if just carried home.

SUBJECT
- A loose, generous group of raw produce shown as itself: leafy greens, a couple of round vegetables, a root vegetable, and one loaf of bread.
- They rest close together in a low, roughly circular heap, overlapping each other rather than lined up in a row. Nothing is arranged into a pattern.
- Everything is raw and whole — nothing cooked, cut, plated or packaged.
- No bag, box, basket, crate, net, paper, label or wrapping of any kind.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    vessel: "none",
    framing:
        "the group is centred in a square frame and fills about two thirds of its width and height, leaving a generous, completely even margin of empty ground on all four sides. Nothing touches or is cropped by an edge, and nothing at all sits in the corners of the frame.",
    renderingEmphasis:
        "The greens are the tallest note and the round vegetables carry the strongest colour.",
    mood: "abundant and everyday — the week's shopping, just in.",
})}`,
    },

    /**
     * Generate — a dish that has not been written yet.
     *
     * The one deliberately unresolved subject, and it shares its idea with
     * `generate-splash` / `generate-dish-tiles`: colour where a dish would be,
     * nothing nameable. Here it is the argument rather than a placeholder — the
     * page it sits on is offering to invent something.
     */
    generate: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of a single ceramic plate holding a dish that has not resolved into anything nameable.

SUBJECT
- ONE shallow plate, and nothing else in the picture. It is the whole subject.
- What it holds is unresolved: soft blooms and folds of peach, sage and warm cream, suggesting food without ever becoming an identifiable ingredient. Nothing on the plate has a name.
- A few small, clean shapes sit among the washes so it reads as a dish taking form rather than as a spill.
- No table, no cutlery, no hands, no second object, no cast pattern.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the plate is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. It is never cropped by an edge, and nothing at all sits in the corners of the frame.",
    renderingEmphasis:
        "The plate's rim stays crisp while the colour inside it stays soft-edged — the contrast between the two is the whole picture.",
    mood: "expectant — a dish about to exist.",
})}`,
    },

    /**
     * The home feed's compose card — "Make a meal of it".
     *
     * **Overhead, and that is the one decision here that is not free.**
     * `generate-cuisine-cards` measured it over 24 renders on 2026-08-05: a
     * three-quarter arrangement of SEVERAL dishes either centres itself in a
     * wide margin or loses its back row entirely, because the near vessels
     * occlude the far ones. This is the only other scene in the app that has to
     * show more than one dish at once, so it inherits that finding rather than
     * re-running it. It also happens to be the truer picture — the card is
     * selling a table laid for an evening, which is a thing you look down at.
     *
     * **Portrait, and stacked DOWN the frame.** The first version was square
     * with the three dishes side by side, and cover-cropping that into the band
     * showed one dish at about three times life size — the whole arrangement,
     * which is the point of the picture, was outside the crop.
     *
     * `3:4` rather than `9:16`, and the difference matters: the ratio has to
     * match the band's VISIBLE region on the card (about 0.9 wide to high),
     * not the clipping window, which overshoots the card's top and bottom and
     * so is much taller than anything anyone sees. A 9:16 painting
     * cover-cropped into that region shows about 60% of its own height — both
     * outer dishes half gone. 3:4 shows about 80%.
     *
     * Framed to BLEED, unlike the three above: it is cover-cropped, so an even
     * margin would be band spent on empty ground.
     */
    menu: {
        aspectRatio: "3:4",
        prompt: `Editorial illustration of a small meal laid out together — several finished dishes, seen from directly above, in a tall upright frame.

SUBJECT
- THREE ceramic vessels and no more: a small shallow bowl, a larger round plate, and a second small bowl. Read together they are a starter, a main and a dessert.
- They are stacked ONE ABOVE ANOTHER down the tall frame — one near the top, one in the middle, one near the bottom — not side by side in a row across it.
- Each holds a different finished dish, so the three differ clearly in colour — one green and leafy, one warm and golden, one soft pink or berry.
- Neighbouring vessels sit close enough to overlap slightly at their rims, so the three read as one gathered arrangement.
- No table, no cloth, no cutlery, no hands, no glasses, no second arrangement.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the tall frame is filled top to bottom by the three stacked vessels, with almost no empty ground left anywhere. The widest vessel runs right up to the left and right edges and may be cropped by them, and the top and bottom vessels may be cropped by the top and bottom edges. The arrangement is never a small group floating in a margin.",
    renderingEmphasis:
        "The circles of the three rims are the strongest shapes in the picture and stay crisp against each other.",
    mood: "generous and companionable — an evening's cooking, all out at once.",
})}`,
    },
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3-pro-image-preview") as Parameters<
    typeof generateImage
>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "client-art");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(SCENES).filter(
        ([name]) => !only || name === only
    );

    console.log("=== Client illustrations ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} scenes\n`);

    let failed = 0;

    for (const [name, scene] of entries) {
        try {
            console.log(`Generating ${name}...`);

            const { base64Data, mimeType } = await generateImage({
                prompt: scene.prompt,
                model: MODEL,
                aspectRatio: scene.aspectRatio,
            });

            if (!base64Data) {
                throw new Error(
                    `Model returned no image data for ${name} — the prompt likely produced a text response.`
                );
            }

            const file = `${name}.${extensionFor(mimeType)}`;
            writeFileSync(join(OUT_DIR, file), Buffer.from(base64Data, "base64"));
            console.log(`✓ ${file}`);
        } catch (error) {
            failed++;
            console.error(
                `✗ ${name}: ${error instanceof Error ? error.message : error}`
            );
        }
        // Same spacing as the other image operations.
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\nWritten to ${OUT_DIR}`);
    // These are bundled into the client binary rather than fetched at runtime,
    // so — exactly like `generate-splash` — nothing here can put them in place:
    // the client is a separate repo and a hardcoded path resolves on one laptop.
    console.log(
        "\nCopy the ones you like into the app:\n" +
            "  cp operations/output/client-art/*.jpg \\\n" +
            "    ../../Projects/fridgeezy/src/assets/images/illustrations/\n" +
            "\nThe client seams are `LockedIllustration` and `ComposeMenuCard`."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
