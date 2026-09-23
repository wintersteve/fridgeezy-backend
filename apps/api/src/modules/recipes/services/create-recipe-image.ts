import {
    buildRecipeImagePrompt,
    encodeRecipeImageVariants,
    generateImage,
    pickBestFraming,
} from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

import { fetchStyleAnchors } from "./style-anchors";

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
 * The encoding these two objects get lives in `@fridgeezy/genai`
 * (`encodeRecipeImageVariants`), along with the measurements behind it and the
 * reason `sharp` is loaded lazily. It moved there when the legacy backfill
 * needed the same numbers: a card encoded at one width here and another there
 * would be an inconsistency nobody would think to look for.
 */

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

/** What a render produced: the hero URL, and the hash if pixels were written. */
interface UploadedImage {
    url: string;
    /**
     * Present only when this call actually encoded something — a fresh render
     * or a legacy conversion. A short-circuit on an existing object returns
     * none, because it did not look at the pixels.
     */
    thumbhash?: string;
}

/**
 * The renders currently in flight, keyed by hero path.
 *
 * **This exists to close a race the thumbhash write could not win on its own.**
 * `uploadVariants` files the hash with `update(...).eq("image", url)`, which
 * only reaches rows that already exist — and the image is deliberately started
 * BEFORE the recipe text is generated, so on a fast render (or a legacy
 * conversion, which touches no model at all) the upload lands while the model
 * is still writing the steps. The update then matches nothing, no error is
 * raised, and that dish keeps a null `thumbhash` for good: nothing re-runs it
 * outside the manual `backfill-recipe-webp` op. The reader gets a blank hero
 * where they would have had a blur.
 *
 * So persistence takes the other side of it. The render is registered here
 * while it runs and {@link attachRecipeThumbhash} waits on it from the moment a
 * row exists, which covers the ordering the `eq` cannot: same invocation, same
 * process, no polling and nothing added to the client's clock.
 *
 * The promise is stored rather than the value, so several rows written for one
 * dish (a variant beside its base) share the single render rather than each
 * starting a wait of its own. Entries are deleted as they settle, so the map is
 * bounded by concurrent generations rather than by the catalogue.
 */
const renders = new Map<string, Promise<UploadedImage>>();

/**
 * Writes both variants for `source` and returns the hero's public URL.
 *
 * The two encodes run together; the two UPLOADS do not. Hero first is what makes
 * a half-finished write degrade into "this dish has no small variant" — which no
 * client ever asks about, since the card path is only derived from a hero URL
 * that came back — rather than into a card variant with no hero behind it.
 */
async function uploadVariants(
    name: string,
    source: Buffer
): Promise<UploadedImage> {
    const { hero, card, thumbhash } = await encodeRecipeImageVariants(source);

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
                // **The LOCAL stack is the exception, and it bites.** The
                // storage server there honours this exactly — a replaced
                // object is served `max-age=31536000` — so on the one stack
                // where art actually gets replaced, expo-image keeps drawing
                // the old picture from disk under an unchanged URL, and the new
                // one is invisible until the cache is dropped. The client's dev
                // menu has "clear image cache" for precisely this.
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
            return { url: "" };
        }
    }

    /*
      The placeholder that makes the recipe page's FIRST frame useful.

      Written here rather than in `persist_recipe` because this is where the
      pixels are: the hash is a property of the picture, and the picture is
      produced by this function. Keyed on the image URL rather than on a recipe
      id because a dish and its variants share one illustration — the storage
      path is derived from the name — so every row pointing at this picture
      should carry its hash.

      Fire-and-forget. A failed update costs the reader a shimmer where they
      would have had a blur, which is what every row had before this column
      existed; it must not take down an image that uploaded successfully.
    */
    const { error: hashError } = await supabaseAdmin
        .from("recipes")
        .update({ thumbhash })
        .eq("image", publicUrl(heroStoragePath(name)));

    if (hashError) {
        console.error(`Could not store thumbhash for ${name}:`, hashError);
    }

    return { url: publicUrl(heroStoragePath(name)), thumbhash };
}

/** What a caller wants from a render that a picture already exists for. */
interface RenderOptions {
    /**
     * Render even though the storage object is already there, replacing it.
     *
     * Every caller on the generation path wants the opposite — the
     * short-circuits below are what stop a re-promotion, a variant and a
     * second device from each paying for the same picture. The admin console
     * is the one caller whose entire intent is "this render is bad, do it
     * again", and for it the short-circuit is not an optimisation but a
     * refusal to do the only thing it asked for.
     *
     * **The legacy-PNG branch is skipped too.** That branch re-encodes existing
     * bytes rather than generating, which is right when the goal is to satisfy
     * a predicted `.webp` and wrong when the goal is new art: forced, it would
     * answer a regeneration request with the same old picture in a new
     * container.
     */
    force?: boolean;
}

async function renderRecipeImage(
    name: string,
    /**
     * The dish's ingredients, forwarded to the prompt — see
     * `buildRecipeImagePrompt`, which carries the two failures that earned it.
     *
     * Optional because the short-circuits above mean most calls never reach the
     * model at all, and because a caller that genuinely has no list should send
     * none rather than an empty one dressed up as a fact.
     *
     * It does NOT reach the storage path, which stays derived from the name
     * alone. So two recipes sharing a name still share one picture, and the
     * ingredients that shaped it are whichever copy rendered first — the same
     * first-writer-wins the name has always had, now with something visible
     * riding on it.
     */
    ingredients?: string[],
    { force = false }: RenderOptions = {}
): Promise<UploadedImage> {
    try {
        const heroPath = heroStoragePath(name);
        const legacyPath = legacyStoragePath(name);

        // One list call for every object under this dish's base name — `search`
        // is a substring match, so it answers for the hero, the card variant and
        // the legacy PNG at once.
        const { data: existing } = await supabaseAdmin.storage
            .from("recipes")
            .list("", { search: normalizeFileName(name) });

        // Forced, nothing counts as already present — which collapses both
        // short-circuits below without either of them growing a branch.
        const has = (path: string) =>
            !force && (existing?.some((file) => file.name === path) ?? false);

        // Already converted: nothing to do, and no model call. No hash comes
        // back either — the picture's own is already on whichever row was
        // written when it rendered, which is what `attachRecipeThumbhash`
        // falls back to copying.
        if (has(heroPath)) return { url: publicUrl(heroPath) };

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
                await supabaseAdmin.storage
                    .from("recipes")
                    .download(legacyPath);

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

        // The house-style pictures, and the prompt has to be told how many
        // arrived: the clause it adds is written differently for one than for
        // several, and an empty set must add nothing at all. `fetchStyleAnchors`
        // answers with [] rather than throwing, so a storage failure costs this
        // dish its register and never its picture.
        const anchors = await fetchStyleAnchors();

        const request = {
            prompt: buildRecipeImagePrompt(name, ingredients, {
                styleReferences: anchors.length,
            }),
            referenceImages: anchors.length ? anchors : undefined,
            numberOfImages: 1,
            aspectRatio: "3:4" as const,
        };

        /*
          Two renders, and the better-FRAMED one is kept.

          Framing is the one property nothing else could pin — `pickBestFraming`
          carries the measurements behind the target. The prompt cannot move it,
          the style anchors move it about ten points and no further, and neither
          makes one render match the next: the same dish arrives at one camera
          and then another, and that variance is what the pictures rejected in
          review have actually been.

          In PARALLEL, so this costs a second image and almost no extra time —
          the calls overlap and the loser is discarded. That is the whole trade:
          image spend doubles per dish, and the dish stops being a coin toss. It
          stays bounded per DISH rather than per view, like everything else on
          this path, because an existing object short-circuits above.
        */
        const rolls = await Promise.all([
            generateImage(request).catch(() => ({ base64Data: undefined })),
            generateImage(request).catch(() => ({ base64Data: undefined })),
        ]);

        const candidates = rolls
            .map((roll) => roll.base64Data)
            .filter((data): data is string => Boolean(data))
            .map((data) => Buffer.from(data, "base64"));

        if (!candidates.length) {
            console.error("No image data received from generateImage");
            return { url: "" }; // Return empty string if no image data
        }

        const { chosen, framings } = await pickBestFraming(candidates);

        console.log(
            `[create-recipe-image] ${name}: ${candidates.length} roll(s) — ` +
                framings
                    .map((framing) =>
                        framing
                            ? `size ${(framing.size * 100).toFixed(0)}% centre ${framing.centre.toFixed(2)} right ${framing.right.toFixed(2)} (score ${framing.score.toFixed(3)})`
                            : "unmeasurable"
                    )
                    .join("   vs   ")
        );

        // The model's framing is kept as-is. A post-processing step that widened
        // the 3:4 render to a square — replicating the edge columns outward, with
        // a corner-shadow correction on top — used to sit here and was removed on
        // 2026-09-11: it introduced visible artefacts of its own, which is worse
        // than the centre crop it was compensating for. Framing is the prompt's
        // job; cropping is the client's. Re-encoding is not cropping.
        return await uploadVariants(name, chosen);
    } catch (error) {
        console.error("Failed to generate and upload recipe image:", error);
        return { url: "" }; // Return empty string on error
    }
}

/**
 * Kick off (or join) this dish's render, and answer with the hero URL.
 *
 * The signature every caller already had — fire-and-forget, the URL is
 * deterministic anyway — with the render registered in {@link renders} for the
 * length of its run so persistence can pick the hash up off it.
 *
 * Joining rather than starting a second render is a small bonus of the same
 * mechanism: two promotions of one dish inside a container now share the model
 * call instead of racing each other to the same storage path.
 */
export function generateAndUploadRecipeImage(
    name: string,
    ingredients?: string[]
): Promise<string> {
    return renderAndRegister(name, ingredients).then((image) => image.url);
}

/**
 * Regenerate a dish's illustration, replacing whatever is there.
 *
 * The admin console's route, and the only caller that passes `force`. It
 * answers with the hash as well as the URL, because the console has a row to
 * repoint and `attachRecipeThumbhash`'s two fallbacks — join the in-flight
 * render, else copy a sibling's — are both wrong here: the sibling's hash
 * describes the picture that was just replaced.
 *
 * **It never joins an in-flight render.** Joining is right for the generation
 * path, where two promotions of one dish should share a model call; here it
 * would hand a curator who pressed the button the picture they are replacing,
 * and pressing it again would join the same one. It still REGISTERS, so a
 * promotion racing this one picks up the new hash rather than starting a third.
 */
export function regenerateRecipeImage(
    name: string,
    ingredients?: string[]
): Promise<UploadedImage> {
    return renderAndRegister(name, ingredients, { force: true });
}

/**
 * Start a render, publish it in {@link renders} for the length of its run, and
 * take it out again — joining one already running unless `force` says not to.
 *
 * Extracted when the forced path arrived, because the registration is what
 * `attachRecipeThumbhash` depends on and two copies of it is one that stops
 * being updated.
 */
function renderAndRegister(
    name: string,
    ingredients?: string[],
    { force = false }: RenderOptions = {}
): Promise<UploadedImage> {
    const heroPath = heroStoragePath(name);
    const running = renders.get(heroPath);

    if (running && !force) return running;

    const render = renderRecipeImage(name, ingredients, { force });

    renders.set(heroPath, render);
    void render
        .catch(() => undefined)
        .finally(() => {
            // Guarded, so a later render for the same dish is not evicted by
            // this one settling.
            if (renders.get(heroPath) === render) renders.delete(heroPath);
        });

    return render;
}

/**
 * Give a freshly written recipe row the blur its picture already has.
 *
 * Called once a row EXISTS, which is the thing `uploadVariants`' own write
 * cannot wait for — see {@link renders}. Two sources, in order:
 *
 * 1. **The render this request started**, if it is still running. Awaited, not
 *    polled: the promise resolves with the hash the moment the upload lands.
 * 2. **A sibling row**, otherwise. A short-circuited render wrote no pixels and
 *    so returns no hash, which is the ordinary case for a variant or a
 *    re-promotion of a dish the catalogue already has art for — and those rows
 *    were missing the hash just as reliably, since the original's `eq` write
 *    ran long before they existed. One indexed-free read on a column we are
 *    already filtering rows by; it is off the client's clock either way.
 *
 * Never throws: a missing blur costs a reader a blank hero for as long as the
 * picture takes to load, which is exactly what every row had before the column
 * existed. It must not be able to fail a save.
 */
export async function attachRecipeThumbhash(
    recipeId: string,
    name: string
): Promise<void> {
    try {
        const url = publicUrl(heroStoragePath(name));

        const rendered = await renders
            .get(heroStoragePath(name))
            ?.catch(() => undefined);

        let thumbhash = rendered?.thumbhash;

        if (!thumbhash) {
            const { data: sibling } = await supabaseAdmin
                .from("recipes")
                .select("thumbhash")
                .eq("image", url)
                .not("thumbhash", "is", null)
                .limit(1)
                .maybeSingle();

            thumbhash = sibling?.thumbhash ?? undefined;
        }

        // Nothing to copy: the picture failed, or has not been drawn yet by
        // anything that reported a hash. `uploadVariants`' own write covers the
        // other ordering, where this row is already there when it lands.
        if (!thumbhash) return;

        const { error } = await supabaseAdmin
            .from("recipes")
            .update({ thumbhash })
            .eq("id", recipeId)
            .is("thumbhash", null);

        if (error) {
            console.error(
                `Could not attach thumbhash to recipe ${recipeId}:`,
                error
            );
        }
    } catch (error) {
        console.error(
            `Could not attach thumbhash to recipe ${recipeId}:`,
            error
        );
    }
}
