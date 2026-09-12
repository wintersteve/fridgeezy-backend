// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { supabaseAdmin } from "@fridgeezy/supabase";
import sharp from "sharp";

/**
 * Re-encodes the committed cuisine artwork from PNG to WebP, in place in storage.
 *
 * These are the only images in the app that are neither generated per dish nor
 * bundled with the binary: nine cuisine cards and nine banners, painted once by
 * `generate-cuisine-cards` / `generate-cuisine-banners` and then read by every
 * home feed forever. As PNG they were **1.5 MB per card and 1.1 MB per banner**,
 * which made a nine-tile shelf the single heaviest thing on the app's entry
 * screen — a cost paid by every reader, for artwork that changes about once a
 * quarter.
 *
 * Unlike the recipe images (see `create-recipe-image.ts`, which converts a dish
 * lazily the next time anything asks for it) this set is small, closed and
 * already painted, so there is nothing to gain from doing it lazily and one thing
 * to lose: the feed would stay slow until somebody happened to open each cuisine.
 *
 * **It is additive and non-destructive.** The `.png` objects are left exactly
 * where they are, so reverting is a client-side change and nothing else; and
 * because the app's URL builders name the extension, a `.webp` nobody points at
 * costs storage and nothing else. Re-running is a no-op for anything already
 * converted.
 *
 *   npx nx run @fridgeezy/database:convert-static-art
 *   npx nx run @fridgeezy/database:convert-static-art -- --force
 *
 * **Run it once per STACK, and remember that the app names the extension.**
 * `cuisineCardUri` asks for `.webp`, so any environment that has not been
 * converted draws nothing at all — not a fallback, not the PNG, nothing. That is
 * exactly how it went wrong the first time: converting the remote project and
 * shipping the client change left the local stack serving 400s for every tile on
 * the home feed. It reads the stack from `SUPABASE_URL`, so:
 *
 *   set -a && . ./apps/api/.env.dev && set +a   # local
 *   set -a && . ./apps/api/.env.production && set +a
 *
 * Storage survives `supabase db reset`, so this is not part of the seed cycle —
 * but a stack rebuilt from scratch needs it again.
 */

/**
 * Per-bucket encoding.
 *
 * `width` is the display width at 3x, not the source width — a cuisine CARD is
 * capped at 180pt by `getCuisineCardWidth`, so 560px covers the densest screen
 * and the source's 864px was never reachable. A BANNER is full-bleed at the
 * screen's own width, so its native 1344px is already the right size and only
 * the format is wrong.
 *
 * Quality 82 is what the recipe pipeline settled on for the same kind of art —
 * flat watercolour on a plain ground, which is where WebP wins biggest.
 */
const TARGETS = [
    { bucket: "cuisine_cards", width: 560, quality: 82 },
    { bucket: "cuisine_banners", width: null, quality: 82 },
] as const;

const force = process.argv.includes("--force");

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

async function convertBucket(target: (typeof TARGETS)[number]) {
    const { bucket, width, quality } = target;

    const { data: files, error } = await supabaseAdmin.storage
        .from(bucket)
        .list("", { limit: 1000 });

    if (error) throw new Error(`${bucket}: ${error.message}`);

    const pngs = (files ?? []).filter((file) => file.name.endsWith(".png"));
    const existing = new Set(
        (files ?? [])
            .filter((file) => file.name.endsWith(".webp"))
            .map((file) => file.name)
    );

    console.log(`\n${bucket}: ${pngs.length} PNG objects`);

    let before = 0;
    let after = 0;
    let converted = 0;

    for (const file of pngs) {
        const webpName = file.name.replace(/\.png$/, ".webp");

        if (existing.has(webpName) && !force) {
            console.log(`  - ${file.name} → already converted`);
            continue;
        }

        const { data: blob, error: downloadError } = await supabaseAdmin.storage
            .from(bucket)
            .download(file.name);

        if (!blob || downloadError) {
            console.error(`  ! ${file.name}: ${downloadError?.message}`);
            continue;
        }

        const source = Buffer.from(await blob.arrayBuffer());

        const pipeline = sharp(source);
        const body = await (width
            ? pipeline.resize({ width, withoutEnlargement: true })
            : pipeline
        )
            .webp({ quality })
            .toBuffer();

        const { error: uploadError } = await supabaseAdmin.storage
            .from(bucket)
            .upload(webpName, body, {
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

        if (uploadError) {
            console.error(`  ! ${webpName}: ${uploadError.message}`);
            continue;
        }

        before += source.length;
        after += body.length;
        converted += 1;

        console.log(
            `  ✓ ${webpName.padEnd(22)} ${kb(source.length).padStart(8)} → ${kb(body.length).padStart(7)}`
        );
    }

    return { converted, before, after };
}

(async () => {
    let before = 0;
    let after = 0;
    let converted = 0;

    for (const target of TARGETS) {
        const result = await convertBucket(target);
        converted += result.converted;
        before += result.before;
        after += result.after;
    }

    if (converted === 0) {
        console.log("\nNothing to convert.");
        return;
    }

    console.log(
        `\n${converted} objects: ${kb(before)} → ${kb(after)} (${(before / after).toFixed(1)}x smaller)`
    );
    console.log(
        "Remember: the app names the extension, so this has no effect until " +
            "`cuisineCardUri`/`cuisineBannerUri` ask for .webp."
    );
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
