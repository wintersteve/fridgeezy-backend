// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * App-icon candidates, in the same painted language as everything else.
 *
 * The icon shipped before this was a flat vector bowl inside a rounded card —
 * the only surface in the product not drawn in the house style, sitting next to
 * a launch screen and a suggestion feed that are nothing but gouache. These are
 * the alternatives.
 *
 * ## Icons want a margin; the splash wanted none
 *
 * `generate-splash` had to fight the model to stop it centring the subject in a
 * clean margin, and the whole low-key story there is about coverage. **Do not
 * carry that lesson here.** An icon is a small object on a home screen, masked
 * to a squircle and often drawn at 40pt; a subject cropped by the edges reads as
 * a mistake at that size, and the mask eats the corners anyway. Most of these
 * therefore ask for exactly what the splash forbade.
 *
 * The exceptions are the two whose subject is colour rather than an object
 * (`washes` and, half-way, `bloom`): with nothing to recognise, a margin leaves
 * a pale square with a smudge in it.
 *
 * ## What actually decides an icon
 *
 * Silhouette at 40pt, not detail at 1024. That is why the overhead pair exist —
 * a vessel seen from directly above is a circle, and a circle survives being
 * shrunk to a thumbnail in a way a three-quarter arrangement does not. Judge
 * these small before judging them large.
 */

/** Every candidate: the subject block, plus the style options it needs. */
const CANDIDATES: Record<string, string> = {
    /** The current icon's idea — a bowl — redrawn in the medium the app uses. */
    "bowl-three-quarter": `Editorial illustration of a single ceramic bowl holding a small, quiet arrangement of soft food colour.

SUBJECT
- ONE bowl, and nothing else in the picture. It is the whole subject.
- What it holds is unresolved: a few soft blooms of peach, sage and warm cream rather than any identifiable ingredient. Nothing in the bowl has a name.
- No table, no cutlery, no second object, no cast pattern.

${buildFoodIllustrationStyle({
    framing:
        "the bowl sits centred in a square frame, filling roughly three quarters of its width, with an even margin of empty ground on all four sides. It is never cropped by an edge.",
    renderingEmphasis:
        "Detail is concentrated on the bowl's rim and the colour inside it; the ground stays completely plain.",
    mood: "calm and singular — one good bowl.",
})}`,

    /** The same bowl, from directly above: a circle, which is what a mask likes. */
    "bowl-overhead": `Editorial illustration of a single ceramic bowl seen from directly above, holding soft blooms of colour.

SUBJECT
- ONE bowl, seen perfectly from above, so it reads as concentric circles: the outer rim, the inner wall, and the colour pooled in the middle.
- What it holds is unresolved — soft peach, sage and cream washes, no identifiable ingredient, nothing with a name.
- No table, no cutlery, no second object.

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the bowl is centred in a square frame and fills about four fifths of its width, leaving a slim even margin of ground all round. It is never cropped by an edge.",
    renderingEmphasis:
        "The concentric rings of the bowl are the strongest shape in the picture and stay crisp.",
    mood: "ordered and still — looking straight down into a bowl.",
})}`,

    /**
     * `bowl-overhead` again on a dark ground — the chosen icon's dark half.
     *
     * It has two jobs and they are the same picture: the iOS dark appearance
     * icon, and the dark-theme splash. Both need an overhead bowl that is
     * recognisably the *same* bowl as the light one, which rules out reusing
     * the flat vector mark (a three-quarter bowl) for either.
     */
    "bowl-overhead-dark": `Editorial illustration of a single ceramic bowl seen from directly above, glowing out of a deep dark field.

SUBJECT
- ONE bowl, seen perfectly from above, so it reads as concentric circles: the outer rim, the inner wall, and the colour pooled in the middle.
- It is lit from within so it rises out of the darkness around it. The dark ground surrounds it on all sides and stays the majority of the picture.
- What it holds is unresolved — soft peach and sage blooms, no identifiable ingredient, nothing with a name.
- No table, no cutlery, no second object.

${buildFoodIllustrationStyle({
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the bowl is centred in a square frame and fills about four fifths of its width, a circle with a slim even margin of dark ground all round. It is never cropped by an edge.",
    renderingEmphasis:
        "The concentric rings of the bowl are the strongest shape and the only light in the picture.",
    mood: "ordered and lit — one bowl in a dark kitchen, seen from above.",
})}`,

    /** A plated dish from above. The plate is the silhouette. */
    "plate-overhead": `Editorial illustration of a plated dish seen from directly above.

SUBJECT
- ONE round ceramic plate holding a composed arrangement of soft colour — peach, sage, warm cream and a little deep coral.
- The food is unresolved: blooms and brushed shapes suggesting a plated dish, with no identifiable ingredient and nothing that has a name.
- No table, no cutlery, no second object.

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the plate is centred in a square frame and fills about four fifths of its width, a perfect circle with a slim even margin of ground around it. It is never cropped by an edge.",
    renderingEmphasis:
        "The plate's circle is the strongest shape; the colour inside it is soft and unresolved.",
    mood: "composed and generous — a dish about to be eaten.",
})}`,

    /** The suggestion card's placeholder, square. Pure colour, edge to edge. */
    washes: `Abstract editorial illustration: soft washes of colour suggesting a dish, with no dish depicted.

SUBJECT
- One continuous field of overlapping translucent watercolour blooms, COVERING THE ENTIRE SQUARE, corner to corner. The washes run off all four edges and are cut by them.
- There is no empty margin anywhere, and no single blob floating in the middle of a bare ground.
- NOTHING is recognisable. No ingredient, no vessel, no plate, no bowl, no food of any kind, no object with a name. Only colour, edge and texture.
- Soft bleeding edges where washes meet; a few fine drifting lines suggesting contour without describing anything.

${buildFoodIllustrationStyle({
    vessel: "none",
    framing:
        "the washes cover the whole square and are cut off by all four edges. No part of the picture is bare ground, and nothing is centred in a margin.",
    renderingEmphasis:
        "Pure gouache and watercolour behaviour — granulation, bleeding, dry-brush — and no drawn subject at all.",
    mood: "unresolved and quiet — the moment before a dish exists.",
})}`,

    /** One bloom, centred. An abstract that still has a silhouette. */
    bloom: `Abstract editorial illustration: a single round bloom of colour, with no dish depicted.

SUBJECT
- ONE soft circular bloom of overlapping washes — peach, sage, warm yellow and deep coral — sitting in the middle of the square like a drop of colour spreading in water.
- Its edge is soft and irregular but it reads clearly as a single round mass, not as a scattered field.
- NOTHING is recognisable. No ingredient, no vessel, no plate, no food of any kind, no object with a name.

${buildFoodIllustrationStyle({
    vessel: "none",
    framing:
        "the bloom is centred in a square frame and fills about three quarters of its width, with plain quiet ground in the four corners. It is never cropped by an edge.",
    renderingEmphasis:
        "Granulation and bleeding are heaviest at the bloom's soft edge, where it dissolves into the ground.",
    mood: "singular and quiet — one drop of colour.",
})}`,

    /** The dark-theme register, borrowed for an icon that reads on any wallpaper. */
    "bowl-dark": `Editorial illustration of a single ceramic bowl glowing out of a deep dark field.

SUBJECT
- ONE bowl, and nothing else. It is the whole subject, lit from within so it rises out of the darkness around it.
- What it holds is unresolved: soft blooms of peach and sage, no identifiable ingredient, nothing with a name.
- The dark ground surrounds the bowl on all sides and stays the majority of the picture.

${buildFoodIllustrationStyle({
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the bowl sits centred in a square frame, filling roughly two thirds of its width, with deep dark ground on all four sides. It is never cropped by an edge.",
    renderingEmphasis:
        "The bowl is the only light in the picture and its edge dissolves gently into the dark.",
    mood: "quiet and lit — one bowl in a dark kitchen.",
})}`,
};

/** See `generate-splash` for why this is pinned rather than taking the default. */
const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3-pro-image-preview") as Parameters<
    typeof generateImage
>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "icons");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(CANDIDATES).filter(
        ([name]) => !only || name === only
    );

    console.log("=== App Icon Candidates ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} candidates at 1:1\n`);

    let failed = 0;

    for (const [name, prompt] of entries) {
        try {
            console.log(`Generating ${name}...`);

            const { base64Data, mimeType } = await generateImage({
                prompt,
                model: MODEL,
                aspectRatio: "1:1",
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
    if (failed > 0) process.exitCode = 1;
}

main();
