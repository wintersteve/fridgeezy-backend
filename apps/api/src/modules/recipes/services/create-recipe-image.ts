import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
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
 * Garnish is constrained by course for the same reason — asked only for
 * "a considered finishing garnish", the model put savoury herbs on a tiramisu.
 */
const buildPrompt = (
    name: string
) => `Editorial food illustration of ${name}, plated with the precision of a Michelin-starred kitchen.

PLATING
- A complete, appetising restaurant portion — generous enough that a diner reads it as a real serving of ${name}. Refine and elevate the presentation; never deconstruct the dish into a sparse, abstract arrangement of a few isolated pieces.
- Compose rather than pile: a clear centrepiece, components placed with intent, and the vessel's rim left clean so the food sits in a ring of calm negative space.
- Add one controlled sauce element (a still pool, a single swoosh, or a few precise dots — never a flood) and one considered finishing garnish. Both must belong to this dish: savoury dishes take micro-herbs, toasted seeds, citrus zest, shaved cheese or a thin drizzle of oil; sweet dishes take fruit, berries, chocolate, caramel, cream, nuts or a dusting of sugar or cocoa — never savoury herbs or vegetables.
- Build height, layering and textural contrast — crisp against soft, glossy against matte.
- Unmistakably ${name}: every ingredient the dish is known for stays present and identifiable, in its own natural colour.

${buildFoodIllustrationStyle({
    // The client crops this three ways — a 520px 3:4 hero, a 272x200 landscape
    // card crop, and a square list thumb — so the vessel has to survive a centre
    // crop to any of them.
    framing:
        "the vessel is complete and precisely centred both horizontally and vertically, filling about three quarters of the frame's width, with an even margin on all four sides — so the image still reads when cropped to a square or to a wide banner.",
    mood: "calm, precise and appetising — the quiet confidence of a tasting menu.",
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

        // Convert base64 to buffer
        const buffer = Buffer.from(base64Data, "base64");

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
