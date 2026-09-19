// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { encodeRecipeImageVariants } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Replaces one dish's illustration with a file rendered by `render-recipe-art`.
 *
 * ## Why this is a separate operation
 *
 * `generateAndUploadRecipeImage` cannot do it: it short-circuits on an existing
 * object at the dish's deterministic path, deliberately, because a dish's
 * picture is established and changing it silently is worse than leaving a
 * mediocre one up. So replacing one has to be somebody's decision, typed out,
 * naming the dish and the file. That is this.
 *
 * ## It encodes through the LIBRARY, never by hand
 *
 * `encodeRecipeImageVariants` is what the API calls, so the hero quality, the
 * card width and the thumbhash come out identical to a freshly generated dish.
 * A `sips` conversion here would be a second set of numbers for the same two
 * objects — the inconsistency that moved that function into `@fridgeezy/genai`
 * in the first place.
 *
 * ## The thumbhash is not optional
 *
 * It is a property of the PICTURE, and it is what the recipe page paints on its
 * first frame before any image request has been made. Replace the pixels and
 * leave the hash and every cold open blurs up the OLD picture for a moment
 * before the new one lands — a defect that appears only on a cold start, which
 * is the hardest kind to notice and the easiest to ship.
 *
 * ## Rows are matched by FILENAME, not by name or by an exact URL
 *
 * One picture serves every row that shares a dish name — the storage path is
 * derived from the name, so difficulty rungs and variants all point at it (Tuna
 * Tataki's three rungs share one file). Every one of them needs the new hash.
 * The match is a `like` on the filename rather than equality on the public URL
 * because `toDeviceReachable` rewrites the host for physical-device testing, so
 * the stored URL is not always the one this process would build.
 *
 * ## What it replaces is kept
 *
 * There is no undo for an upsert and no version history on the bucket, so the
 * objects being overwritten are downloaded to `output/recipe-art/replaced/`
 * first. They are the only copy: a dish's illustration is generated once, ever,
 * and the model will not produce that picture again. The hero alone is enough
 * to put one back — the card variant and the thumbhash are derived from it by
 * the same function that writes them here.
 *
 * ## A legacy PNG row is repointed, and saying so is the point
 *
 * A dish illustrated before the WebP pipeline has `image` ending `.png`. This
 * writes `.webp`, so without the repoint the row keeps serving the old picture
 * and the upload is invisible. The legacy object is left in place — nothing
 * deletes from this bucket.
 *
 * Usage:
 *   npx jiti operations/install-recipe-art.ts --dish="Shrimp Risotto" \
 *     --from=gemini-3.1-flash-image/shrimp_risotto-2.jpg
 *   (add --yes to actually write; without it this is a dry run)
 */

const arg = (name: string) =>
    process.argv
        .find((a) => a.startsWith(`--${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");

const has = (name: string) => process.argv.includes(`--${name}`);

const DISH = arg("dish");
const FROM = arg("from");
const FILE = arg("file");
const CONFIRMED = has("yes");

/** Mirrors `create-recipe-image`'s `normalizeFileName` exactly. */
const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

const RENDER_DIR = join(process.cwd(), "operations", "output", "recipe-art");

async function main() {
    if (!DISH || (!FROM && !FILE)) {
        console.error(
            'Usage: --dish="Shrimp Risotto" --from=<model>/<file>.jpg [--yes]'
        );
        process.exitCode = 1;
        return;
    }

    const source = FILE
        ? isAbsolute(FILE)
            ? FILE
            : join(process.cwd(), FILE)
        : join(RENDER_DIR, FROM as string);

    const slug = slugify(DISH);
    const heroPath = `${slug}.webp`;
    const cardPath = `${slug}_sm.webp`;
    const legacyPath = `${slug}.png`;

    // The one line that stops this being run against the wrong database. The
    // local .env carries production's URL commented out one line above the
    // local one, so the distance between the two is a `#`.
    const target = process.env.SUPABASE_URL ?? "(unset)";

    console.log("=== Install recipe art ===\n");
    console.log(`Database: ${target}`);
    console.log(`Dish:     ${DISH}`);
    console.log(`Source:   ${source}`);
    console.log(`Writes:   recipes/${heroPath}`);
    console.log(`          recipes/${cardPath}\n`);

    const bytes = readFileSync(source);

    // Every row sharing this dish's picture — rungs and variants included.
    const { data: rows, error: readError } = await supabaseAdmin
        .from("recipes")
        .select("id, name, image, difficulty")
        .or(`image.like.%/${heroPath},image.like.%/${legacyPath}`);

    if (readError) {
        console.error(
            "Could not read the rows pointing at this picture:",
            readError
        );
        process.exitCode = 1;
        return;
    }

    if (!rows?.length) {
        console.warn(
            `No recipe row points at ${heroPath} or ${legacyPath}. The objects ` +
                `can still be replaced, but nothing in the catalogue shows them.`
        );
    } else {
        console.log(`${rows.length} row(s) share this picture:`);
        for (const row of rows) {
            const legacy = row.image?.endsWith(".png")
                ? "  ← legacy .png, will be repointed"
                : "";
            console.log(`  ${row.name} (${row.difficulty})${legacy}`);
        }
        console.log("");
    }

    if (!CONFIRMED) {
        console.log("Dry run. Nothing was written — add --yes to install.");
        return;
    }

    // Keep what is about to be lost. An upsert has no undo and the bucket has no
    // versioning, so this runs BEFORE the first upload and aborts the install if
    // it cannot write — a replacement that cannot be reversed is not one to make
    // quietly.
    const backupDir = join(RENDER_DIR, "replaced", slug);
    mkdirSync(backupDir, { recursive: true });

    for (const path of [heroPath, cardPath, legacyPath]) {
        const { data, error } = await supabaseAdmin.storage
            .from("recipes")
            .download(path);

        // A missing object is the normal case for the legacy path, and for both
        // webp paths on a dish that has never been illustrated.
        if (error || !data) continue;

        writeFileSync(
            join(backupDir, path),
            Buffer.from(await data.arrayBuffer())
        );
        console.log(`  kept ${path} → output/recipe-art/replaced/${slug}/`);
    }

    const { hero, card, thumbhash } = await encodeRecipeImageVariants(bytes);

    for (const [path, body] of [
        [heroPath, hero],
        [cardPath, card],
    ] as const) {
        const { error } = await supabaseAdmin.storage
            .from("recipes")
            .upload(path, body, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, not a header — see `create-recipe-image`, which
                // carries the measurement showing this is currently inert.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`✗ ${path}:`, error);
            process.exitCode = 1;
            return;
        }
        console.log(`✓ uploaded ${path}`);
    }

    const heroUrl = supabaseAdmin.storage.from("recipes").getPublicUrl(heroPath)
        .data.publicUrl;

    for (const row of rows ?? []) {
        // A legacy row is repointed to the webp as well as re-hashed; a row
        // already on the webp keeps whatever host it was written with.
        const patch: { thumbhash: string; image?: string } = { thumbhash };
        if (row.image?.endsWith(".png")) patch.image = heroUrl;

        const { error } = await supabaseAdmin
            .from("recipes")
            .update(patch)
            .eq("id", row.id);

        if (error) console.error(`✗ ${row.name}:`, error);
        else
            console.log(
                `✓ ${row.name}${patch.image ? " (repointed to .webp)" : ""}`
            );
    }

    console.log(
        "\nDone. The replaced objects are in output/recipe-art/replaced/" +
            slug +
            ". " +
            "Note that a device holding the old picture may keep drawing it: " +
            "expo-image caches on the URL, and the URL has not changed."
    );
}

main();
