// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * The launch screen: the dish placeholder's washes, full bleed, one variant per
 * theme.
 *
 * ## Why this is not part of `generate-dish-tiles`
 *
 * It shares that file's `PLACEHOLDER_PROMPT` idea — colour where a dish would
 * be, nothing nameable — and nothing else. The tile is composed to be *cropped*
 * by the client: its washes gather low and fade out toward the top so the empty
 * upper half becomes the margin around a floated plate. A launch screen is the
 * opposite brief. It is never cropped to a short box, it is stretched to a
 * phone, and any bare ground in the composition arrives as a cream void around
 * a small floating blob. So the subject description is inverted — the washes
 * have to *cover* the frame — and that is a different picture, not a different
 * crop of the same one.
 *
 * The tile also must not be touched: `bowl-placeholder.png` is live in every
 * suggestion card, and re-rolling it for the splash's benefit would change art
 * that was chosen for a different surface.
 *
 * ## Why these are written to disk rather than uploaded
 *
 * Every other image operation here uploads to a Supabase bucket, because every
 * other image is fetched at runtime. A splash screen is drawn *before the app
 * has run*, let alone reached the network — it has to be bundled into the
 * binary, which means it lives in the client repo as a committed file that
 * `app.json` points at. Nothing here can put it there: the client is a separate
 * repo, and a hardcoded `../../Projects/fridgeezy` path is the thing that
 * resolves on one laptop and fails on EAS Build. So this prints the copy step
 * the same way `generate-env` prints the client's `EXPO_PUBLIC_*` lines.
 *
 * ## The `backgroundColor` in `app.json` is a palette token, not a sampled hex
 *
 * `generate-cuisine-cards` records the measurement that would otherwise matter:
 * **the model does not reproduce a requested hex.** Asked for `#FBE4E1` it
 * returned `#EEE4DD`; `padPngToSquare` saw a `#FDFBF9` ground land near
 * `#F6F0E0`. So the `ground` below steers the mood and nothing else.
 *
 * It happens not to matter, and it is worth writing down why rather than
 * building a sampler to chase it. On iOS `resizeMode: "cover"` fills the screen
 * — the background colour is never visible behind a full-bleed image. On
 * Android the artwork is never shown *at all* (the system splash takes a flat
 * colour and a centred icon), so there is no artwork for a colour to match: it
 * should simply be the app's own `background` token, which is what the screen
 * one frame later will be.
 *
 * The one place the model's actual output shows is the iOS hand-off, and that
 * is a cut between two full screens rather than a seam between two adjacent
 * surfaces. Judge it by looking at the render.
 */

/**
 * The two variants, and why `dark` names a tone as well as a ground.
 *
 * A ground alone does not produce a dark image. Measured 2026-08-06: three
 * renders asking for `#141110` with the shared style otherwise untouched all
 * came back on cream, because `Tone`, `Palette` and `Light` were each pushing
 * the other way. `tone: "low-key"` is the option added to
 * `buildFoodIllustrationStyle` for exactly this — see its doc comment for what
 * the three lines were and why they move together.
 *
 * `light` stays `high-key`, which is the default, so it is byte-identical to
 * what every other surface in the app is generated against.
 */
const VARIANTS = {
    light: {
        ground: { name: "warm cream", hex: "#FBF5E5" },
        tone: "high-key",
    },
    dark: {
        ground: { name: "deep warm brown-black", hex: "#141110" },
        tone: "low-key",
    },
} as const;

type Variant = keyof typeof VARIANTS;

/**
 * The subject, written as a description of the *object* rather than of the
 * camera.
 *
 * `generate-dish-tiles` measured this over fifteen renders and it is the single
 * most reusable finding in the image pipeline: framing instructions do not
 * work, object descriptions do. Three prompts that asked the camera to push in
 * or fill the frame all came back centred with a large margin. So "covering the
 * entire surface, corner to corner" is a claim about what the washes *are*, and
 * the negative — no empty margin, cut by all four edges — is repeated because
 * that is the failure this asset cannot survive.
 *
 * The "nothing recognisable" clause is inherited verbatim from
 * `PLACEHOLDER_PROMPT` and is doing the same work: left looser, the model
 * resolves the blooms into an actual dish. On a launch screen that would be
 * worse than on a card — it would promise a specific meal to someone who has
 * not opened the app yet.
 */
const buildPrompt = (variant: Variant) => {
    const { ground, tone } = VARIANTS[variant];

    /**
     * "Full bleed" means opposite things on the two grounds, and getting this
     * backwards is what round three of this prompt got wrong.
     *
     * On cream, the ground is the thing you are trying to hide: bare cream in
     * the frame is a void, so the instruction is to cover every corner with
     * pigment. Told the same thing on a dark ground, the model does exactly as
     * asked — it covers the dark with pale pigment and the picture comes back
     * light again. The dark ground can only survive if it is *most of the
     * picture*, with the blooms rising out of it and reaching the edges without
     * ever closing into a sheet.
     *
     * So low-key does not ask for coverage, it asks for reach. Both still fill
     * the frame; one fills it with paint and the other with dark.
     */
    const subject =
        tone === "low-key"
            ? `- Blooms of soft opaque gouache rising out of a deep, dark field. THE DARK GROUND IS THE MAJORITY OF THE PICTURE and stays plainly visible between, around and behind the blooms.
- The blooms reach and are cut by all four edges — there is no clean margin of untouched ground framing them — but they never merge into one opaque sheet that hides the dark. Think embers in a dark room, not paint on a dark wall.
- The blooms are strongest through the middle band of the frame and dissolve back into the dark toward the top and bottom.`
            : `- One continuous field of overlapping translucent watercolour blooms, COVERING THE ENTIRE SURFACE, corner to corner. The washes run off all four edges of the picture and are cut by them.
- There is no empty margin anywhere, and no single blob floating in the middle of a bare ground. Colour reaches every corner.
- The blooms are deepest and most layered through the middle band of the frame and thin toward the top and bottom, but they never stop before an edge.`;

    return `Abstract editorial illustration: soft washes of colour suggesting a dish, with no dish depicted.

SUBJECT
${subject}
- NOTHING is recognisable. No ingredient, no vessel, no plate, no bowl, no food of any kind, no object with a name. Only colour, edge and texture.
- Soft edges where washes meet; a few fine drifting lines suggesting contour without describing anything.

${buildFoodIllustrationStyle({
    vessel: "none",
    ground,
    tone,
    framing:
        tone === "low-key"
            ? "the blooms are cut off by all four edges, with the dark ground showing between and behind them right across the frame. Nothing is centred in a margin, and nothing is framed by a border of bare ground."
            : "the washes cover the whole frame and are cut off by all four edges. No part of the picture is bare ground, and nothing is centred in a margin.",
    renderingEmphasis:
        tone === "low-key"
            ? "Pure gouache and soft-pastel behaviour — grain, chalky blends, dry-brush drag over the dark ground — and no drawn subject at all."
            : "Pure gouache and watercolour behaviour — granulation, bleeding, dry-brush — and no drawn subject at all.",
    mood: "unresolved and quiet — the moment before a dish exists.",
})}`;
};

/**
 * Pinned to Pro, unlike everything else in this directory.
 *
 * `generate-image` defaults to Flash on a volume argument — cost is bounded per
 * dish, and at thousands of dishes the 3.6x matters. That argument does not
 * reach this asset. There are two images here, they are generated once ever,
 * and they are the first thing every user sees on every launch. Pro is the
 * known-better answer for this art direction (measured 2026-08-04) and the
 * whole bill is under a dollar.
 *
 * Still overridable, because Pro is a *preview* endpoint that can be renamed.
 */
const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3-pro-image-preview") as Parameters<
    typeof generateImage
>[0]["model"];

/**
 * How many candidates per variant. These are curated art, not derived data —
 * `generate-dish-tiles` refuses to overwrite for the same reason — so the
 * useful output is a set to choose from, not one roll presented as the answer.
 */
const candidates = Number(
    process.argv.find((a) => a.startsWith("--candidates="))?.split("=")[1] ?? 3
);

/**
 * Which variants to roll, so a failed theme can be re-rolled without paying for
 * the one that already worked — which is the normal case here, since the two
 * are generated against different tones and fail independently.
 */
const only = process.argv
    .find((a) => a.startsWith("--variant="))
    ?.split("=")[1] as Variant | undefined;

if (only && !(only in VARIANTS)) {
    console.error(
        `Unknown --variant=${only}. Expected one of: ${Object.keys(VARIANTS).join(", ")}`
    );
    process.exit(1);
}

const targets = (only ? [only] : (Object.keys(VARIANTS) as Variant[])) as Variant[];

const OUT_DIR = join(process.cwd(), "operations", "output", "splash");

/**
 * The file extension for what the model actually sent back.
 *
 * **This endpoint returns JPEG, whatever the name of the thing asking suggests.**
 * The other image operations never had to notice: they hand `mimeType` straight
 * to Supabase storage as `contentType`, so the bytes and the label always
 * agreed. Writing to disk has no such luck, and a `.png` holding JPEG bytes is
 * a trap for the next person — `padPngToSquare` in `libs/genai` parses PNG
 * chunks directly and would fail on one in a way that says nothing useful.
 */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

async function generateOne(
    variant: Variant,
    index: number
): Promise<string | null> {
    const stem = `splash-${variant}-${index}`;

    try {
        console.log(`Generating ${stem}...`);

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(variant),
            model: MODEL,
            // 9:16 is the tallest this endpoint offers and phones are taller
            // (9:19.5), so `cover` crops the sides. That is fine *because* the
            // prompt asks for edge-to-edge colour — there is no composition to
            // lose at the left and right. It would not be fine for a subject.
            aspectRatio: "9:16",
        });

        // The model sometimes answers a prompt with text and no image at all;
        // passing that to Buffer.from() raises an opaque TypeError instead of
        // saying what went wrong.
        if (!base64Data) {
            throw new Error(
                `Model returned no image data for ${stem} — the prompt likely produced a text response.`
            );
        }

        const file = `${stem}.${extensionFor(mimeType)}`;
        writeFileSync(join(OUT_DIR, file), Buffer.from(base64Data, "base64"));

        console.log(`✓ ${file}`);
        return file;
    } catch (error) {
        console.error(
            `✗ ${stem}: ${error instanceof Error ? error.message : error}`
        );
        return null;
    }
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    console.log("=== Splash Screen Generation ===\n");
    console.log(`Model:      ${MODEL}`);
    console.log(`Variants:   ${targets.join(", ")}`);
    console.log(
        `Candidates: ${candidates} each (${candidates * targets.length} images)\n`
    );

    const results: string[] = [];

    for (const variant of targets) {
        for (let i = 1; i <= candidates; i++) {
            const file = await generateOne(variant, i);
            if (file) results.push(file);
            // Same spacing as the other image operations — enough to stay clear
            // of the image API's rate limit on a back-to-back run.
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    console.log("\n=== Summary ===\n");
    console.log(`${results.length} of ${candidates * targets.length} written to`);
    console.log(`  ${OUT_DIR}\n`);

    for (const file of results) console.log(`  ${file}`);

    console.log(`
Next, by hand:

  1. Look at them. Pick one light and one dark.
  2. Copy the two you chose into the client repo, keeping the extension the
     model actually produced:

       cp <chosen-light> <client>/src/assets/images/splash-light.<ext>
       cp <chosen-dark>  <client>/src/assets/images/splash-dark.<ext>

  3. Point app.json's expo-splash-screen "ios" block at them. Leave the
     backgroundColor as the app's own token — see the note at the top of this
     file for why it is not sampled from the image.
`);

    if (results.length < candidates * targets.length) process.exitCode = 1;
}

main();
