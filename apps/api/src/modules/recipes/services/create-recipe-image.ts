import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

/**
 * Normalizes a recipe name to create a safe filename for storage.
 * Removes diacritics and special characters, replacing them with ASCII equivalents.
 */
const normalizeFileName = (name: string): string => {
    return name
        .normalize("NFD") // Decompose combined characters into base + diacritics
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric chars with underscore
        .replace(/^_+|_+$/g, ""); // Trim leading/trailing underscores
};

/**
 * Encoding for the two objects every dish now gets.
 *
 * The model returns PNG, and these illustrations are flat watercolour on a plain
 * ground — the one thing PNG is worst at. Measured on a real 864x1184 render:
 * **1522 KB as PNG, 58 KB as WebP q82 at the same pixel dimensions**, and 11 KB
 * at 420px wide. That is what made the feed slow; almost none of it was the
 * dimensions of the picture.
 *
 * So the HERO is not resized at all — the recipe page draws it ~520pt wide, so
 * 864px is already only ~1.7x on a 3x screen and there is nothing worth giving
 * away for 26 more KB. The CARD variant is the resize: card slots are 248-272pt
 * and lists draw a small square thumb, so 420px is the width worth storing a
 * second copy at.
 *
 * `withoutEnlargement` because a future model or a hand-placed asset could be
 * narrower than `CARD_WIDTH`, and upscaling to hit a number is worse than
 * serving what there is. Both encodes together cost ~70ms, against a model call
 * measured in seconds.
 */
const HERO_QUALITY = 82;
const CARD_WIDTH = 420;
const CARD_QUALITY = 75;

/**
 * The hero path, and the reason it is a real `.webp` rather than WebP bytes
 * hidden under the old `.png` name.
 *
 * The extension is LOAD-BEARING as a signal. `persistRecipeWithIngredientIds`
 * stores the *predicted* URL rather than waiting for the upload, so prediction
 * and upload have to agree — and on the client a stored URL ending `.webp` is
 * the guarantee that `<name>_sm.webp` was written beside it by this same
 * function. That is what lets a card ask for the small one with no existence
 * check and no 404 fallback, and what makes a legacy `.png` row degrade by
 * simply never asking.
 */
const heroStoragePath = (name: string): string =>
    `${normalizeFileName(name)}.webp`;

/** The card/thumbnail variant, always written together with the hero. */
const cardStoragePath = (name: string): string =>
    `${normalizeFileName(name)}_sm.webp`;

/**
 * Where dishes generated before this pipeline still live. Read, never written:
 * there is no backfill and these objects are left exactly as they are.
 */
const legacyStoragePath = (name: string): string =>
    `${normalizeFileName(name)}.png`;

const publicUrl = (path: string): string =>
    toDeviceReachable(
        supabaseAdmin.storage.from("recipes").getPublicUrl(path).data.publicUrl
    );

/**
 * The deterministic public URL a recipe's image will live at, derived purely
 * from its name. Valid to store BEFORE generation finishes uploading — the URL
 * resolves once the (async) upload lands. Lets persistence set `image_url`
 * without blocking on, or re-triggering, image generation.
 *
 * Always the WebP hero, which is why `generateAndUploadRecipeImage` below has to
 * end with a `.webp` at this path for every dish it is asked about — including
 * one that already has a legacy PNG. A row pointing at an extension nothing ever
 * wrote is a dish with no picture and nothing in the logs.
 */
export const getRecipeImagePublicUrl = (name: string): string =>
    publicUrl(heroStoragePath(name));

/**
 * The plating half of the prompt. The style half is shared with the cuisine
 * tiles via `buildFoodIllustrationStyle` — the two render side by side in the
 * app, and keeping the contract in one place is what stops them drifting apart.
 *
 * "Complete, appetising portion … never deconstruct" is a guard, not filler:
 * Michelin plating language on its own shrinks a Caesar salad to two leaves and
 * a smear, which is art-directed but reads as no food at all on a recipe card.
 *
 * That guard needs its own counterweight, though, and the two must be edited as
 * a pair. Read as a quantity instruction it made every dish built from repeated
 * units come back as a full batch — ten macarons scattered across the plate,
 * which is a bakery display, not a plated course. The serving-form bullet is
 * what splits the two cases: a mass dish takes the generous portion, a
 * unit dish takes one to three pieces with a hero. Loosen one side and the other
 * side's failure comes straight back.
 *
 * Garnish is constrained by course for the same reason — asked only for
 * "a considered finishing garnish", the model put savoury herbs on a tiramisu.
 *
 * The two restraint bullets look like a third contradiction of the portion
 * guard and are not: they constrain how much of the *plate* is used, never how
 * much food is served. Both survived a blind A/B (2026-08-04) across five
 * dishes and two models, where this version tied the plain prompt on Gemini 3
 * Pro and beat it on Flash — which is the reason it is the default rather than
 * the plain one. If image quality ever has to fall back to a cheaper model,
 * this is the variant that degrades better.
 */
const buildPrompt = (
    name: string
) => `Editorial food illustration of ${name}, plated with the precision of a Michelin-starred kitchen.

PLATING
- A complete, appetising restaurant portion — generous enough that a diner reads it as a real serving of ${name}. Refine and elevate the presentation; never deconstruct the dish into a sparse, abstract arrangement of a few isolated pieces.
- Compose rather than pile: a clear centrepiece, components placed with intent, and the vessel's rim left clean so the food sits in a ring of calm negative space.
- How much of ${name} appears depends on how it is served. A dish plated as one mass — a salad, curry, pasta, soup, stew, risotto, roast — keeps the generous portion above. A dish made of repeated discrete units — macarons, cookies, dumplings, sushi, canapés, cupcakes, ravioli, tartlets, skewers — is plated as a chef would serve one guest: one hero piece, or at most three, never a batch, a tray, a stack or a row.
- When there are two or three units, arrange them deliberately — one best-formed piece front and centre as the hero, the others tucked slightly behind or resting against it at different angles. Never a grid, never a line, never evenly spaced or repeated at identical angles. One unit may be halved or bitten to reveal its interior layers and texture.
- Add one controlled sauce element (a still pool, a single swoosh, or a few precise dots — never a flood) and one considered finishing garnish. Both must belong to this dish: savoury dishes take micro-herbs, toasted seeds, citrus zest, shaved cheese or a thin drizzle of oil; sweet dishes take fruit, berries, chocolate, caramel, cream, nuts or a dusting of sugar or cocoa — never savoury herbs or vegetables. The fewer units on the plate, the more this carries the composition: a single piece is never left alone on a bare plate, it is finished with a drizzle, a scatter of fruit or a quenelle beside it.
- Build height, layering and textural contrast — crisp against soft, glossy against matte.
- Unmistakably ${name}: every ingredient the dish is known for stays present and identifiable, in its own natural colour.
- Restraint is the point. The food occupies a compact area near the centre of the vessel and no more than half its surface; the surrounding plate stays genuinely empty. Fewer elements, placed more deliberately, with more space between them than feels necessary.
- Garnish is counted, not scattered: a precise number of pieces you could tally at a glance, each placed individually. No sprinkling, no dusting across the whole plate, no crumbs trailing to the rim.

${buildFoodIllustrationStyle({
    // The client crops this three ways — a 520px 3:4 hero, a 272x200 landscape
    // card crop, and a square list thumb — so the vessel has to survive a centre
    // crop to any of them.
    //
    // The "two thirds" is aspirational and the model does not honour it. Measured
    // over six dishes on 2026-08-04, asking for three quarters and asking for two
    // thirds both render the plate at ~77% of frame width, a smaller difference
    // than the per-dish spread (72–83%). A third phrasing pinning the plate to
    // the middle half of the height did better — it halved the clipping — but
    // still swung between 51% and 87% of frame height across dishes on one
    // prompt. **Rewording this will not reliably change the plate's size.**
    // Adding the margin after generation was tried instead (a deterministic pad
    // to square) and removed for the artefacts it introduced, so this prompt is
    // the only lever there is.
    framing:
        "the vessel is complete and precisely centred both horizontally and vertically, filling about two thirds of the frame's width, with a generous and even margin of empty background on all four sides — so the image still reads when cropped to a square or to a wide banner.",
    renderingEmphasis:
        "Detail is concentrated on the centrepiece and falls away toward the rim, so the eye lands in one place.",
    mood: "spare, exact and expensive — one confident gesture, generously surrounded by empty plate.",
})}`;

/**
 * Writes both variants for `source` and returns the hero's public URL.
 *
 * The two encodes run together; the two UPLOADS do not. Hero first is what makes
 * a half-finished write degrade into "this dish has no small variant" — which no
 * client ever asks about, since the card path is only derived from a hero URL
 * that came back — rather than into a card variant with no hero behind it.
 */
async function uploadVariants(name: string, source: Buffer): Promise<string> {
    // Imported here rather than at the top of the file, for three reasons that
    // each stand alone:
    //
    //  * `sharp` is a ~30 MB native module and loading libvips is not free. Only
    //    this path needs it, and it runs as a background task — so a chat turn
    //    or a recipe stream on a cold Lambda should not pay for it.
    //  * The deployment artifact carries LINUX binaries (see
    //    `infra/build-artifact.sh`), while `build-artifact.sh` verifies the
    //    handler's module graph loads on the build machine. A static import
    //    would make that check require a macOS binary the artifact must not
    //    contain.
    //  * It matches how `@fridgeezy/llm` defers its provider SDKs.
    const { default: sharp } = await import("sharp");

    const [hero, card] = await Promise.all([
        sharp(source).webp({ quality: HERO_QUALITY }).toBuffer(),
        sharp(source)
            .resize({ width: CARD_WIDTH, withoutEnlargement: true })
            .webp({ quality: CARD_QUALITY })
            .toBuffer(),
    ]);

    for (const [path, body] of [
        [heroStoragePath(name), hero],
        [cardStoragePath(name), card],
    ] as const) {
        const { error } = await supabaseAdmin.storage
            .from("recipes")
            .upload(path, body, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, NOT a header — supabase-js prefixes `max-age=`
                // to whatever you pass, so a full directive string is stored as
                // the malformed `max-age=public, max-age=31536000, immutable`.
                //
                // **And it is currently inert on this project**: measured
                // 2026-09-12, a public object uploaded with this stores
                // `max-age=31536000` in its metadata and is still SERVED as
                // `cache-control: no-cache` (the storage gateway reports
                // `sb-gateway-mode: direct`). Kept anyway — it is the correct
                // value, it costs nothing, and it starts working the day the
                // gateway honours it. Do not read the presence of this line as
                // evidence that responses are cacheable.
                //
                // What that costs in practice is small: expo-image keeps its own
                // disk cache regardless of HTTP semantics, and Cloudflare still
                // holds the bytes and revalidates (`cf-cache-status:
                // REVALIDATED`), so the price is one conditional request per
                // image rather than a re-download. The bytes themselves are the
                // win — see the WebP encode above.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`Failed to upload ${path}:`, error);
            return "";
        }
    }

    return publicUrl(heroStoragePath(name));
}

export async function generateAndUploadRecipeImage(
    name: string
): Promise<string> {
    try {
        const heroPath = heroStoragePath(name);
        const legacyPath = legacyStoragePath(name);

        // One list call for every object under this dish's base name — `search`
        // is a substring match, so it answers for the hero, the card variant and
        // the legacy PNG at once.
        const { data: existing } = await supabaseAdmin.storage
            .from("recipes")
            .list("", { search: normalizeFileName(name) });

        const has = (path: string) =>
            existing?.some((file) => file.name === path) ?? false;

        // Already converted: nothing to do, and no model call.
        if (has(heroPath)) return publicUrl(heroPath);

        // A dish generated before this pipeline, being asked for again — a
        // re-promotion, or a blacklist-adapted variant taking the base's name.
        //
        // CONVERTED, not regenerated. `getRecipeImagePublicUrl` has already
        // predicted a `.webp` for whatever row is about to be written, so
        // returning the PNG's URL would leave the row pointing at an extension
        // nothing wrote; and generating fresh art would both cost a model call
        // and silently change a dish's established picture. Re-encoding the
        // bytes that already exist satisfies the prediction, keeps the art, and
        // costs one download plus ~70ms.
        //
        // This is deliberately NOT a backfill: it fires only for a dish some
        // request actually touched, so it is bounded by traffic rather than by
        // the size of the catalogue, and the legacy object is left in place.
        if (has(legacyPath)) {
            const { data: legacy, error: downloadError } =
                await supabaseAdmin.storage.from("recipes").download(legacyPath);

            if (legacy && !downloadError) {
                console.log(`Converting legacy image for ${name} to WebP`);
                return await uploadVariants(
                    name,
                    Buffer.from(await legacy.arrayBuffer())
                );
            }

            console.error(
                `Could not read legacy image for ${name}:`,
                downloadError
            );
            // Fall through and generate — better a new picture than none.
        }

        const { base64Data } = await generateImage({
            prompt: buildPrompt(name),
            numberOfImages: 1,
            aspectRatio: "3:4",
        });

        if (!base64Data) {
            console.error("No image data received from generateImage");
            return ""; // Return empty string if no image data
        }

        // The model's framing is kept as-is. A post-processing step that widened
        // the 3:4 render to a square — replicating the edge columns outward, with
        // a corner-shadow correction on top — used to sit here and was removed on
        // 2026-09-11: it introduced visible artefacts of its own, which is worse
        // than the centre crop it was compensating for. Framing is the prompt's
        // job; cropping is the client's. Re-encoding is not cropping.
        return await uploadVariants(name, Buffer.from(base64Data, "base64"));
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        return ""; // Return empty string on error
    }
}
