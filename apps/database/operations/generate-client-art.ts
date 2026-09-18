// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * The client's illustrations that are not about a specific dish.
 *
 * Three locked pages — the Saved tab, the Shopping tab and the recipe generator
 * — plus the home feed's compose card, the first-run welcome pair, and the
 * crash screen. That is what they have in common and what decides their
 * subjects: every other image operation here is handed a recipe, a cuisine or
 * an ingredient and paints *that*. These have to say what a whole capability is
 * for, in a language the style already speaks.
 *
 * `crash` is the one that is not selling anything — it has to say that
 * something went wrong without reading as an alarm. Its own note explains why
 * a collapse is the only failure this medium can draw without the FIXED STYLE
 * trailer having to give.
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
     * The crash screen — a soufflé that has fallen.
     *
     * The one scene here that is not selling a capability. `ErrorState`'s
     * `crash` kind draws it when a route throws, so the picture has to carry a
     * failure without reading as an alarm: the red disc it replaced said
     * *something is wrong with the app*, where a sunken soufflé says *that
     * didn't work, do it again* — which is the only thing the one button on
     * that screen can act on.
     *
     * **A collapse is the one failure this medium is actually good at.** The
     * subject is a change of SHAPE, not of colour: a crater below a rim, a
     * crack across a crust, a collar that is still there to prove it had
     * risen. Everything the house style is strict about — the pale chalky
     * register, the soft edges, the one warm grey line — survives that
     * unchanged, so this is the only wrong-thing picture the app can draw
     * without renegotiating the trailer. Burnt food needs a near-black the
     * palette forbids; a spill needs ground outside a vessel that `Background`
     * bans; a sad face needs `not cartoonish` removed.
     *
     * **Three-quarter, unlike the other three medallions.** They are overhead
     * or nearly so because a circle is what survives a round mask. This one
     * cannot be: from directly above a sunken soufflé and a full one are the
     * same circle, and the whole subject is that the middle is LOWER than the
     * rim. The default 45 degrees is what shows the crater at all — and it is
     * the angle the rest of the app's food is drawn at, so nothing is being
     * bent to accommodate it.
     */
    crash: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of a soufflé that has collapsed in its dish.

SUBJECT
- ONE small round deep straight-sided ceramic dish, and nothing else in the picture. It is the whole subject.
- What it holds has risen and then fallen. Its surface has sunk into a wide shallow crater that sits clearly BELOW the rim, dipping deepest in the middle, wrinkled and settled where it came down.
- The crust across the top is cracked open in one or two places, showing the softer pale interior through the break.
- A thin risen collar still clings to the inside of the rim all the way round, standing a little above the sunken middle, so it is obvious the whole thing was once taller than it is now.
- One small green herb leaf has come down with it and rests in the crater.
- No table, no cloth, no spoon, no oven, no hands, no second object, no cast pattern, and nothing at all outside the dish.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the dish is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. It is never cropped by an edge, and nothing at all sits in the corners of the frame.",
    renderingEmphasis:
        "The dip from the rim down into the sunken middle is the strongest shape in the picture and reads immediately; the crack across the crust stays crisp while the settled surface stays soft-edged.",
    mood: "deflated and a little comic — it was going so well.",
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
     * **Portrait, and a HIERARCHY rather than a row.** The first version was
     * square with three dishes side by side, and cover-cropping that into the
     * band showed one dish at about three times life size — the whole
     * arrangement, which is the point of the picture, was outside the crop.
     * The second stacked three equal vessels down the frame, which fixed the
     * scale and not the subject: a narrow vertical slice through three equal
     * circles keeps the middle one, and a single bowl is not a menu.
     *
     * This version gives the picture a subject that survives being cut — ONE
     * large plate with three small bowls gathered beneath it. The size
     * difference is the information, so any slice holding part of the hero and
     * part of a companion still reads as *a dish and the meal around it*, which
     * is the sentence the card itself makes ("One dish, a whole menu.").
     * Chosen over two alternatives rendered beside it on 2026-09-14: a
     * six-vessel ribbon (more robust to the crop, but it says "many courses"
     * rather than "one dish plus"), and a vessel-less field of components
     * (nothing to bisect, but the least like the rest of the app).
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
        prompt: `Editorial illustration of one large dish surrounded by the smaller dishes that go with it, seen from directly above, in a tall upright frame.

SUBJECT
- ONE large round ceramic plate holding a generous main dish, sitting high in the tall frame and clearly the biggest thing in the picture. It is wide enough to be cropped by the left and right edges.
- Gathered below and slightly behind it, THREE much smaller bowls holding side dishes, overlapping the big plate's lower rim and each other.
- The size difference is obvious and deliberate: one hero and its companions, not four equal dishes.
- The main is warm and golden; the small bowls differ clearly from it and from each other — one green and leafy, one soft pink or berry, one pale and creamy.
- No table, no cloth, no cutlery, no hands, no glasses, no second arrangement.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the large plate and its cluster of small bowls fill the tall frame top to bottom with almost no empty ground left. The large plate is cropped by the left and right edges and the lowest bowls are cropped by the bottom edge. The arrangement is never a small group floating in a margin.",
    renderingEmphasis:
        "The big plate's circle dominates; the small rims cluster against its lower edge and stay crisp.",
    mood: "generous and hospitable — one good dish, and everything that came with it.",
})}`,
    },
    /**
     * The first-run welcome screen, which is a PAIR.
     *
     * It is full-bleed across the top of the page and graded into the page
     * ground, so unlike every other scene here it is never a subject in a
     * margin — an even border would be a strip of cream above the fold.
     *
     * **Two files, because the ground is baked in.** The light one is a cream
     * field; behind a dark-theme page it is a lit slab above dark copy. The
     * screen picks between them on `rt.themeName`, the way the app icon and the
     * splash already do. `1:1` rather than a phone aspect: the screen
     * cover-crops it to about 58% of the window height at whatever width the
     * device is, so a square gives the crop room in both directions.
     *
     * Both are framed to bleed and the dark one carries the low-key medium —
     * see `RENDERING_MEDIUM`, where watercolour over a dark ground is what puts
     * a pale border back.
     */
    welcome: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of an evening meal on the table, seen from directly above, filling the whole frame.

SUBJECT
- A generous overhead arrangement: one large plated main, two smaller bowls, a scatter of herbs and a small pool of sauce, gathered close together.
- The arrangement runs off all four edges — vessels are cropped by the frame on every side — so it reads as part of a larger table.
- Colours differ clearly between the dishes: one warm and golden, one green and leafy, one soft pink or berry.
- No cutlery, no cloth, no hands, no glasses.
- ONE single illustration, not a grid, a contact sheet, a set of panels or a collection of separate pictures.

FIXED STYLE — identical in every image
- Camera: perfectly overhead bird's-eye, 90 degrees, straight down. No perspective tilt at all: a round vessel reads as a true circle, a rectangular one as a true rectangle, and nothing shows a side wall or a front face. Every vessel lies flat to the picture plane.
- Vessel: matte handmade ceramic in creamy off-white (#FFF5EE) with subtle artisanal texture and a slightly irregular hand-thrown rim. Its shape follows the dish (flat plate, shallow bowl, deep bowl); its material and colour never change. Use plain clear glassware only for drinks and layered desserts.
- Framing: the arrangement covers the entire square and is cropped by all four edges. There is no empty margin anywhere and nothing floats in the middle of bare ground.
- Background: flat warm cream (#FDFBF9), completely empty — its colour is pigment settled into a fine, quiet, even tooth, and that tooth continues unbroken beneath everything else in the picture, at the same scale everywhere. No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel. No borders, frames or inset panels — the background runs to all four edges of the image.
- Light: soft diffuse studio daylight from the upper left, casting exactly one gentle, soft-edged, low-contrast shadow from the vessel toward the lower right. No other shadows anywhere — no dappled light, no foliage or window patterns, no shadows from objects outside the frame. No hard specular highlights.
- Palette: the vessel, background and linework are fixed — cream #FFF5EE, warm stone #FAF8F6, ground #FDFBF9, with warm grey #5C5450 only as sparse, fine linework — never a near-black outline; peach #F4A67A and sage green #93C5A8 are the accent tones. The food keeps its own true hues, rendered in the same warm register. No saturated primaries, no neon, no pure black.
- Tone: high-key, pastel and softly washed throughout. Every value sits in the upper, lighter half of the range, as if a thin veil of warm cream were laid over the whole image — colours are chalky, faded and gently muted rather than rich, punchy or glossy. Even the darkest element stays a soft warm mid-tone; contrast between light and dark is low and edges between colours are soft. This is a treatment of saturation and value only: it must never change *which* colour a food is, only how pale and quiet it reads.
- Rendering: refined modern editorial illustration — true watercolour and gouache worked into the tooth of cold-press paper — the surface the whole picture is made on, never a sheet or a page lying inside it. No wash is an even fill: pigment granulates into that tooth, each wash loads unevenly and dries a little lighter through its middle and a shade deeper where it pooled or stopped, and a dry brush skips and breaks where it crosses the grain. Where a wash dried back on itself it leaves a slightly harder rim inside its own colour, half a step deeper — never a dark contour and never an outline around a shape — and the paper takes the ground colour named above, with only its tooth showing. The warm grey linework is drawn over that same tooth, sparse and fine, breaking where the tooth rides high, open rather than a sealed continuous outline, and never darkening toward black even at its heaviest. The tooth is one fine, quiet, even scale in every image and runs unbroken to all four edges with no edge, corner or shadow of its own; shapes stay simple, minimal, airy and warm. The overlapping rims are the strongest shapes; the picture is densest in the middle and quietens toward the lower edge, where type will sit over it. Not photorealistic, not 3D-rendered, not cartoonish, not high-contrast.

Mood: warm and generous — the moment everything reaches the table.

Render the illustration only. No text, letters, numbers, labels, logos, watermarks, borders or frames. The hex colour codes above are instructions to you, not things to depict — never write, print or paint a colour code, caption or swatch anywhere in the picture.`,
    },

    welcomeDark: {
        aspectRatio: "1:1",
        prompt: `Editorial illustration of an evening meal on the table, seen from directly above, glowing out of a deep dark field and filling the whole frame.

SUBJECT
- A generous overhead arrangement: one large plated main, two smaller bowls, a scatter of herbs and a small pool of sauce, gathered close together and lit from within so they rise out of the darkness.
- The arrangement runs off all four edges — vessels are cropped by the frame on every side — so it reads as part of a larger table.
- Colours stay warm and deepened: golden, amber, a little sage.
- No cutlery, no cloth, no hands, no glasses.
- ONE single illustration, not a grid, a contact sheet, a set of panels or a collection of separate pictures.

FIXED STYLE — identical in every image
- Camera: perfectly overhead bird's-eye, 90 degrees, straight down. No perspective tilt at all: a round vessel reads as a true circle, a rectangular one as a true rectangle, and nothing shows a side wall or a front face. Every vessel lies flat to the picture plane.
- Vessel: matte handmade ceramic in creamy off-white (#FFF5EE) with subtle artisanal texture and a slightly irregular hand-thrown rim. Its shape follows the dish (flat plate, shallow bowl, deep bowl); its material and colour never change. Use plain clear glassware only for drinks and layered desserts.
- Framing: the arrangement covers the entire square and is cropped by all four edges. There is no pale margin anywhere and no lighter border of any kind at the edges of the square.
- Background: flat deep warm brown-black (#141110), completely empty — its colour is pigment settled into a fine, quiet, even tooth, and that tooth continues unbroken beneath everything else in the picture, at the same scale everywhere. No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel. No borders, frames or inset panels — the background runs to all four edges of the image.
- Light: soft ambient glow with no visible source and no cast shadow anywhere — the vessel is lit from within rather than from outside, so nothing throws a shadow onto the ground and the ground is never lit into a pool. No dappled light, no foliage or window patterns, no hard specular highlights.
- Palette: the background and linework are fixed — ground #141110, with warm dark grey #3A322C only as sparse, fine linework; peach #F4A67A and sage green #93C5A8 are the accent tones, and they sit as soft glows rising out of the dark rather than as bright shapes laid on top of it. The food keeps its own true hues, deepened into the same warm register. No saturated primaries, no neon, and no cream or white anywhere.
- Tone: low-key and deep throughout. Every value sits in the lower, darker half of the range: the ground is the darkest thing in the picture and everything else rests only a little above it, the way pigment glows on dark water. There is no cream, no white and no pale wash anywhere — nothing is bleached toward the light end. Colours stay chalky and gently muted rather than rich, punchy or glossy; even the lightest element stays a soft warm mid-tone, and contrast between light and dark is low with soft edges between colours. This is a treatment of saturation and value only: it must never change *which* colour a food is, only how deep and quiet it reads.
- Rendering: refined modern editorial illustration — delicate hand-drawn linework, and soft OPAQUE gouache and chalk pastel laid down over a dark ground. The pigment is body colour that covers the darkness beneath it, never a transparent wash that lets a pale paper glow through — every soft edge is pigment blending into pigment. Clean flat-leaning shapes; minimal and warm. This is not watercolour, and there is no white or cream paper anywhere in the picture. The dishes are the only light in the picture; it is densest in the middle and settles into near-empty dark toward the lower edge, where type will sit over it. Not photorealistic, not 3D-rendered, not cartoonish, not high-contrast.

Mood: warm and quiet — the moment everything reaches the table, at night.

Render the illustration only. No text, letters, numbers, labels, logos, watermarks, borders or frames. The hex colour codes above are instructions to you, not things to depict — never write, print or paint a colour code, caption or swatch anywhere in the picture.`,
    },
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

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
    // These are bundled into the client binary rather than fetched at runtime,
    // so — exactly like `generate-splash` — nothing here can put them in place:
    // the client is a separate repo and a hardcoded path resolves on one laptop.
    console.log(
        "\nCopy the ones you like into the app:\n" +
            "  cp operations/output/client-art/*.jpg \\\n" +
            "    ../../Projects/fridgeezy/src/assets/images/illustrations/\n" +
            "\nThe client seams are `ArtMedallion` and `ComposeMenuCard`."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
