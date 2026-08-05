import {
    buildFoodIllustrationStyle,
    generateImage,
    padPngToSquare,
} from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

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

// A recipe's image always lives at this single, deterministic path (one
// extension), so its public URL can be computed from the name alone \u2014 no
// storage lookup, and no need to await generation before knowing the URL.
const imageStoragePath = (name: string): string =>
    `${normalizeFileName(name)}.png`;

/**
 * The deterministic public URL a recipe's image will live at, derived purely
 * from its name. Valid to store BEFORE generation finishes uploading \u2014 the URL
 * resolves once the (async) upload lands. Lets persistence set `image_url`
 * without blocking on, or re-triggering, image generation.
 */
export const getRecipeImagePublicUrl = (name: string): string =>
    supabaseAdmin.storage.from("recipes").getPublicUrl(imageStoragePath(name))
        .data.publicUrl;

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
    // The margin that actually matters is added after generation instead, by
    // `padPngToSquare`, which is deterministic.
    framing:
        "the vessel is complete and precisely centred both horizontally and vertically, filling about two thirds of the frame's width, with a generous and even margin of empty background on all four sides — so the image still reads when cropped to a square or to a wide banner.",
    renderingEmphasis:
        "Detail is concentrated on the centrepiece and falls away toward the rim, so the eye lands in one place.",
    mood: "spare, exact and expensive — one confident gesture, generously surrounded by empty plate.",
})}`;

export async function generateAndUploadRecipeImage(
    name: string
): Promise<string> {
    try {
        const filePath = imageStoragePath(name);

        // Reuse an existing image for this dish name if we already have one.
        const { data: existingFile } = await supabaseAdmin.storage
            .from("recipes")
            .list("", { search: filePath });

        if (existingFile?.some((file) => file.name === filePath)) {
            return getRecipeImagePublicUrl(name);
        }

        const { base64Data, mimeType } = await generateImage({
            prompt: buildPrompt(name),
            numberOfImages: 1,
            aspectRatio: "3:4",
        });

        if (!base64Data) {
            console.error("No image data received from generateImage");
            return ""; // Return empty string if no image data
        }

        // Widen the 3:4 render to a square before storing it. The client shows
        // this one file in boxes from 0.62 to 1.36 aspect, all cropping to fill;
        // at 3:4 the widest of those cut through the plate on every dish
        // measured. Padding is what makes one asset survive all three, and it
        // has to happen here rather than at display time because the surfaces
        // are full-bleed — see `padPngToSquare` for the rejected alternatives.
        const buffer = padPngToSquare(Buffer.from(base64Data, "base64"));

        // Always store at the single deterministic path (the content type still
        // reflects the real bytes, which is what clients render by).
        const { error } = await supabaseAdmin.storage
            .from("recipes")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) {
            console.error("Failed to upload recipe image:", error);
            return ""; // Return empty string on upload error
        }

        return getRecipeImagePublicUrl(name);
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        return ""; // Return empty string on error
    }
}
