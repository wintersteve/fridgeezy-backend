// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * Art for the welcome-screen redesign — five concepts, one operation.
 *
 * Everything here goes through `buildFoodIllustrationStyle` UNEDITED. Unlike
 * `generate-crash-art`, nothing on this screen needs a face or any other
 * departure: a welcome screen is the app at its most ordinary, showing food.
 *
 * ## The three framings, and they are not interchangeable
 *
 * - **`medallion`** — a disc, like every locked page: subject centred, about
 *   two thirds of the frame, corners expendable. Concepts that animate
 *   individual dishes need them round, because a rectangle arriving on cream
 *   reads as a photograph landing and a disc reads as a plate.
 * - **`bleed`** — runs off all four edges, like the welcome pair it replaces.
 *   For anything the screen cover-crops into a band, where an even margin is
 *   a strip of empty cream above the fold.
 * - **`hero`** — one dish, cropped HARD, much tighter than either. The point of
 *   that concept is scale, and a plate floating in a margin is the opposite of
 *   it.
 *
 * ## Why `dissolve` is two prompts that describe the same footprint
 *
 * Concept 4 cross-fades raw ingredients into the finished dish, and a dissolve
 * only reads as a transformation if the two states occupy the same space —
 * otherwise it is a slideshow. Both prompts therefore pin the arrangement to
 * the same place in the frame, at the same scale. If they are ever regenerated,
 * regenerate them TOGETHER and check them on top of each other.
 *
 * ## Why the dayparts are three files and not one
 *
 * Concept 5 opens on breakfast, lunch or dinner depending on the clock, which
 * the app can already answer (`getDaypart`). Three paintings is the cost of
 * that, and it is the concept's whole idea — an app that is different at 8am
 * and 8pm. They share a framing so the screen's layout does not move between
 * them.
 */

/** Said to every scene — see `generate-client-art`, where it is not boilerplate. */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE subject, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, quadtych, mood board, set of variations, or a frame divided into panels or quadrants by any line, gutter or border.`;

const MEDALLION_FRAMING =
    "the vessel is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. It is never cropped by an edge, and nothing at all sits in the corners of the frame.";

const BLEED_FRAMING =
    "the arrangement covers the entire square and is cropped by all four edges. There is no empty margin anywhere and nothing floats in the middle of bare ground.";

interface Scene {
    prompt: string;
    aspectRatio: Parameters<typeof generateImage>[0]["aspectRatio"];
}

/** A single dish seen from above, for the concepts that animate them one at a time. */
const medallion = (subject: string, emphasis: string): Scene => ({
    aspectRatio: "1:1",
    prompt: `Editorial illustration of ${subject}, seen from directly above.

SUBJECT
- ONE vessel, and nothing else in the picture. It is the whole subject.
- It reads as concentric circles: the outer rim, the inner wall, and the food pooled in the middle.
- The food is a settled, appetising arrangement — something already made, not something being prepared.
- No table, no cutlery, no hands, no second object, no cast pattern.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing: MEDALLION_FRAMING,
    renderingEmphasis: `The concentric rings of the vessel are the strongest shape in the picture and stay crisp. ${emphasis}`,
    mood: "settled and warm — a dish worth cooking.",
})}`,
});

const SCENES: Record<string, Scene> = {
    // --- Concepts 1 and 3: dishes that arrive, and dishes that drift ---------
    // Five, chosen so no two sit next to each other in the same colour. They
    // are shared by both concepts: one arrives them on a stagger, the other
    // scrolls them forever, and neither wants a sixth badly enough to pay for
    // it.
    dishSoup: medallion(
        "a shallow bowl of warm spiced squash soup with a swirl of cream and a scatter of seeds",
        "The swirl is the one drawn gesture inside the bowl."
    ),
    dishGreens: medallion(
        "a wide bowl of leafy green salad with soft herbs and a few pale shavings",
        "The leaves are the tallest note and keep their own clear edges."
    ),
    dishPasta: medallion(
        "a shallow bowl of golden ribbon pasta turned in a light sauce, with a few torn basil leaves",
        "The turned ribbons catch the light and stay legible as strands."
    ),
    dishBerries: medallion(
        "a small bowl of soft pink berry compote with whole raspberries and blackberries on top",
        "The whole berries are the strongest shapes and the compote stays soft-edged."
    ),
    dishRoast: medallion(
        "a shallow bowl of roasted root vegetables in amber and orange, with thyme over them",
        "The roasted edges are the warmest note in the picture."
    ),

    // --- Concept 2: one dish, cropped hard ----------------------------------
    // The framing is the whole concept. An even margin here would produce the
    // same floating plate every other surface in the app already has.
    hero: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of a single generous dish, seen very close.

SUBJECT
- ONE ceramic bowl holding a rich, finished dish — golden and herb-flecked, with real height and layering.
- The camera is close enough that the bowl runs past the edges of the frame on at least two sides: this is a detail of a dish, not a picture of a whole plate.
- The food itself fills most of what can be seen, and its textures are the subject.
- No table, no cutlery, no hands, no second object.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl is much larger than the frame and is cropped by at least two edges, so the food fills the picture. There is no even margin and no empty ground at the corners — at most one small quiet area of ground in a single corner.",
    renderingEmphasis:
        "Texture is the whole picture: the grain of the food, the layering, and the crisp inner rim where it meets the vessel.",
    mood: "close, warm and appetising — the moment before the first mouthful.",
})}`,
    },

    // --- Concept 4: the same footprint, twice -------------------------------
    // These two cross-fade into each other, so the arrangement is pinned to the
    // same place in both. Regenerate them together.
    dissolveRaw: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of raw ingredients gathered in a loose ring, seen from directly above.

SUBJECT
- A generous gathering of raw ingredients shown as themselves: leafy greens, two or three round vegetables, a root vegetable, a few herbs and a scatter of small things.
- They are arranged in a broad, roughly circular gathering that sits in the MIDDLE of the frame and reaches out toward all four edges, densest in the centre and thinning toward the corners.
- Everything is raw and whole — nothing cooked, cut, plated or packaged.
- No bag, box, basket, crate, net, paper, label or wrapping of any kind, and no vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    vessel: "none",
    camera: "overhead",
    framing: BLEED_FRAMING,
    renderingEmphasis:
        "The gathering is densest at the centre of the frame and thins evenly toward every edge.",
    mood: "abundant and everyday — what you already have in.",
})}`,
    },
    dissolveCooked: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of one finished dish, seen from directly above.

SUBJECT
- ONE large round ceramic bowl holding a complete, generous, finished dish, with a green herb note over it.
- The bowl sits in the MIDDLE of the frame and is large enough to reach out toward all four edges, densest in the centre.
- It is unmistakably something already cooked and ready to eat — no raw ingredients anywhere in the picture.
- No table, no cutlery, no hands, no second object.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing: BLEED_FRAMING,
    renderingEmphasis:
        "The bowl is centred in the frame and its rim is the strongest circle in the picture.",
    mood: "warm and complete — dinner, made.",
})}`,
    },

    // --- Concept 4, dark ----------------------------------------------------
    // The pair again on a dark ground, because the light ones bake in their own
    // cream and full-bleed behind a dark page they are two lit slabs — the
    // failure `onArtwork` exists to name, and the reason the welcome screen has
    // always been a PAIR. `low-key` rewrites four of the eight FIXED STYLE
    // lines (see `RENDERING_MEDIUM`: watercolour on a dark ground is the one
    // thing the medium cannot survive, so the paint turns opaque), which is why
    // these are eyeballed rather than trusted.
    dissolveRawDark: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of raw ingredients gathered in a loose ring, seen from directly above, glowing out of a deep dark field.

SUBJECT
- A generous gathering of raw ingredients shown as themselves: leafy greens, two or three round vegetables, a root vegetable, a few herbs and a scatter of small things.
- They are arranged in a broad ring that sits in the MIDDLE of the frame with a clear open space at its centre, and they thin toward the corners.
- Everything is raw and whole — nothing cooked, cut, plated or packaged.
- No bag, box, basket, crate, net, paper, label or wrapping of any kind, and no vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    vessel: "none",
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the ring is centred in the square and reaches out toward all four edges, with an open space at its centre. There is no pale margin anywhere and no lighter border of any kind at the edges of the square.",
    renderingEmphasis:
        "The ring is densest at its band and opens to bare dark ground at the very centre of the frame.",
    mood: "abundant and quiet — what you already have in, at night.",
})}`,
    },
    dissolveCookedDark: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of one finished dish, seen from directly above, glowing out of a deep dark field.

SUBJECT
- ONE large round ceramic bowl holding a complete, generous, finished dish, with a green herb note over it.
- The bowl sits in the MIDDLE of the frame, in the same place and at the same size a wide ring of ingredients would occupy.
- It is unmistakably something already cooked and ready to eat — no raw ingredients anywhere in the picture.
- No table, no cutlery, no hands, no second object.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the bowl is centred in the square and large enough to reach toward all four edges. There is no pale margin anywhere and no lighter border of any kind at the edges of the square.",
    renderingEmphasis:
        "The bowl's rim is the strongest circle in the picture and the food inside it is the only light.",
    mood: "warm and complete — dinner, made, at night.",
})}`,
    },

    // --- Concept 5: three times of day --------------------------------------
    // Same framing across all three, so the layout does not shift when the
    // clock changes which one is drawn.
    daypartMorning: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of breakfast on the table, seen from directly above, filling the whole frame.

SUBJECT
- A generous overhead arrangement of BREAKFAST: a bowl of porridge or yoghurt topped with fruit, a small plate of toast, a scatter of berries and nuts, and a cup of coffee seen from above as a dark circle.
- The arrangement runs off all four edges — vessels are cropped by the frame on every side — so it reads as part of a larger table.
- It is unmistakably a morning meal: nothing savoury, cooked or dinner-like anywhere in it.
- No cutlery, no cloth, no hands.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing: BLEED_FRAMING,
    renderingEmphasis:
        "The overlapping rims are the strongest shapes; the picture is densest in the middle and quietens toward the lower edge, where type will sit over it.",
    mood: "bright and unhurried — the start of a day.",
})}`,
    },
    daypartMidday: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of lunch on the table, seen from directly above, filling the whole frame.

SUBJECT
- A generous overhead arrangement of LUNCH: a big leafy salad bowl, an open sandwich or flatbread on a board-less plate, a small bowl of soup, and a scatter of herbs.
- The arrangement runs off all four edges — vessels are cropped by the frame on every side — so it reads as part of a larger table.
- It is unmistakably a light midday meal: fresher and greener than dinner, with no heavy roast or dessert.
- No cutlery, no cloth, no hands.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing: BLEED_FRAMING,
    renderingEmphasis:
        "The overlapping rims are the strongest shapes; the picture is densest in the middle and quietens toward the lower edge, where type will sit over it.",
    mood: "fresh and quick — the middle of a day.",
})}`,
    },
    daypartEvening: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of dinner on the table, seen from directly above, filling the whole frame.

SUBJECT
- A generous overhead arrangement of DINNER: one large plated main with real height, two smaller side bowls, a pool of sauce and a scatter of herbs, gathered close together.
- The arrangement runs off all four edges — vessels are cropped by the frame on every side — so it reads as part of a larger table.
- It is unmistakably an evening meal: warmer, richer and deeper in colour than breakfast or lunch.
- No cutlery, no cloth, no hands.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing: BLEED_FRAMING,
    renderingEmphasis:
        "The overlapping rims are the strongest shapes; the picture is densest in the middle and quietens toward the lower edge, where type will sit over it.",
    mood: "warm and generous — the moment everything reaches the table.",
})}`,
    },
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "welcome-art");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(SCENES).filter(
        ([name]) => !only || name === only
    );

    console.log("=== Welcome screen concepts ===\n");
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
            writeFileSync(
                join(OUT_DIR, file),
                Buffer.from(base64Data, "base64")
            );
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
    console.log(
        "\nWhichever concept wins, downscale on the way in — the model returns\n" +
            "1024px and every committed illustration is 640. See `ArtMedallion`."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
