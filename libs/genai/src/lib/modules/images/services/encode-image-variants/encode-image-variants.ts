/**
 * The two objects every generated dish illustration is stored as.
 *
 * The model returns PNG, and these are flat watercolour on a plain ground — the
 * one thing PNG is worst at. Measured on a real 864x1184 render: **1522 KB as
 * PNG, 58 KB as WebP q82 at the same pixel dimensions**, and 11 KB at 420px
 * wide. That is what made the feed slow; almost none of it was the dimensions
 * of the picture.
 *
 * The HERO is not resized at all — the recipe page draws it ~520pt wide, so
 * 864px is already only ~1.7x and there is nothing worth giving away for 26
 * more KB. The CARD variant is the resize: card slots are 248-272pt, so 420px
 * is the width worth storing a second copy at.
 *
 * **It lives in this library so two callers cannot drift apart on the numbers.**
 * `create-recipe-image` writes these at generation time; `backfill-recipe-webp`
 * writes them for dishes illustrated before the pipeline existed. A card
 * encoded at a different width or quality by one of them would be a visible
 * inconsistency nobody would think to look for.
 */
export const HERO_QUALITY = 82;
export const CARD_WIDTH = 420;
export const CARD_QUALITY = 75;

export interface RecipeImageVariants {
    /** Full render, WebP. */
    hero: Buffer;
    /** {@link CARD_WIDTH} wide, WebP. */
    card: Buffer;
    /**
     * A ~30-byte ThumbHash of the picture, base64, for
     * `expo-image`'s `placeholder={{ thumbhash }}`.
     *
     * **It is the only preview that works on a COLD open.** The card variant
     * doubles as a progressive preview on the recipe page, but only when the
     * reader arrives from a card that already cached it — `expo-image` will not
     * display a placeholder that is itself still loading, so a share link, a
     * deep link or an unscrolled feed gets nothing. This travels inside the
     * recipe row, so it is on screen in the same frame as the title, before any
     * image request has been made at all.
     */
    thumbhash: string;
}

/**
 * The longest edge ThumbHash is fed.
 *
 * Its encoder is capped at 100x100 and the hash is a fixed handful of bytes
 * whatever it is given, so anything larger is pixels decoded for nothing. 64 is
 * comfortably inside that and keeps the resize cheap — this runs on every
 * generated dish.
 */
const THUMBHASH_MAX_EDGE = 64;

/**
 * Encode a source image into the hero/card pair.
 *
 * `withoutEnlargement` because a future model or a hand-placed asset could be
 * narrower than {@link CARD_WIDTH}, and upscaling to hit a number is worse than
 * serving what there is. Both encodes together cost ~70ms, against a model call
 * measured in seconds.
 */
export async function encodeRecipeImageVariants(
    source: Buffer,
): Promise<RecipeImageVariants> {
    // Deferred for the reason `normaliseGround` states: a ~30 MB native module
    // that a cold Lambda start must not pay for unless it is actually encoding.
    const { default: sharp } = await import("sharp");

    // Deferred alongside sharp: a pure-JS module, but there is no reason for a
    // cold start that never encodes an image to parse it.
    const { rgbaToThumbHash } = await import("thumbhash");

    const [hero, card, preview] = await Promise.all([
        sharp(source).webp({ quality: HERO_QUALITY }).toBuffer(),
        sharp(source)
            .resize({ width: CARD_WIDTH, withoutEnlargement: true })
            .webp({ quality: CARD_QUALITY })
            .toBuffer(),
        sharp(source)
            .resize({
                width: THUMBHASH_MAX_EDGE,
                height: THUMBHASH_MAX_EDGE,
                fit: "inside",
            })
            // RGBA, and the alpha channel is not optional — `rgbaToThumbHash`
            // reads four bytes per pixel and silently produces a garbled hash
            // from three.
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
    ]);

    const thumbhash = Buffer.from(
        rgbaToThumbHash(
            preview.info.width,
            preview.info.height,
            preview.data,
        ),
    ).toString("base64");

    return { hero, card, thumbhash };
}
