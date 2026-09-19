import "dotenv/config";

import { encodeRecipeImageVariants } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Re-encode the pre-WebP recipe illustrations, in place in storage.
 *
 *   npx jiti operations/backfill-recipe-webp.ts
 *   npx jiti operations/backfill-recipe-webp.ts -- --dry
 *
 * ## Why this is needed when `create-recipe-image` already converts
 *
 * It converts LAZILY, and deliberately so: its own note says the legacy path
 * "fires only for a dish some request actually touched, so it is bounded by
 * traffic rather than by the size of the catalogue." What that note assumes is
 * that reading a recipe touches it. It does not — the conversion sits inside
 * `generateAndUploadRecipeImage`, which runs when a dish is GENERATED. A dish
 * illustrated before the WebP pipeline is therefore never converted by anything,
 * however often it is read.
 *
 * ## What that costs while it lasts, measured
 *
 * `dishImageCardUri` derives `<name>_sm.webp` from the hero's extension, and
 * returns nothing for a `.png` — correctly, because one function wrote both
 * variants or neither, so the extension IS the existence guarantee. The card
 * then falls back to the hero. On the local catalogue on 2026-09-18: **22
 * dishes still PNG-only, mean 1657 KB**, each of them drawing that full file
 * into a 248pt card slot. A twelve-card feed of them moves **19.5 MB** where the
 * converted equivalent moves 0.15 MB.
 *
 * It also costs the recipe page its progressive preview: `RecipeHeroImage` shows
 * the cached `_sm` while the hero loads, and a legacy dish has none to show.
 *
 * ## Two halves, and the second is the one that is easy to miss
 *
 * Converting the OBJECT is not enough. `DishImage` resolves
 * `image || recipeImageUri(name)`, so a row that stores a `.png` URL keeps
 * pointing at the legacy file however many WebP siblings exist beside it — the
 * column wins. So this repoints those rows too, by swapping the extension in
 * the stored string rather than rebuilding the URL, which leaves whatever host
 * the row already carries untouched.
 *
 * The two passes are independent on purpose: a stack where the objects were
 * converted but the rows were not is a real state (it is what a half-finished
 * run leaves), and the second pass has to be able to fix it on its own.
 *
 * ## It is additive and reversible
 *
 * The `.png` objects are left exactly where they are, so undoing this is a
 * client change and nothing else — the app names the extension it wants, and
 * `recipes.image` rows are not rewritten here. Re-running is a no-op for
 * anything already converted.
 *
 * **Run it once per STACK.** It reads `SUPABASE_URL`, so:
 *
 *   set -a && . ./apps/api/.env.dev && set +a          # local
 *   set -a && . ./apps/api/.env.production && set +a
 */
const BUCKET = "recipes";

const dry = process.argv.includes("--dry");

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

async function main() {
    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { limit: 5000 });

    if (error) throw new Error(`Could not list ${BUCKET}: ${error.message}`);

    const files = data ?? [];
    const names = new Set(files.map((f) => f.name));

    // A legacy object whose `.webp` sibling already exists has been converted
    // by the lazy path already; leave it alone rather than re-encoding a
    // picture that may since have been regenerated.
    const pending = files.filter(
        (f) =>
            f.name.endsWith(".png") &&
            !names.has(f.name.replace(/\.png$/, ".webp")),
    );

    console.log(`=== Legacy recipe images ===`);
    console.log(`Stack: ${process.env.SUPABASE_URL}`);
    console.log(`${pending.length} to convert of ${files.length} objects\n`);

    if (dry) {
        pending.forEach((f) =>
            console.log(`· ${f.name} — ${kb(f.metadata?.size ?? 0)}`),
        );
        console.log("\nDry run, nothing written.");
        return;
    }

    let before = 0;
    let after = 0;
    let failed = 0;

    for (const file of pending) {
        const base = file.name.replace(/\.png$/, "");

        const { data: blob, error: downloadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .download(file.name);

        if (!blob || downloadError) {
            console.error(`✗ ${base}: ${downloadError?.message}`);
            failed++;
            continue;
        }

        const source = Buffer.from(await blob.arrayBuffer());
        const { hero, card } = await encodeRecipeImageVariants(source);

        let ok = true;

        for (const [path, body] of [
            [`${base}.webp`, hero],
            [`${base}_sm.webp`, card],
        ] as const) {
            const { error: uploadError } = await supabaseAdmin.storage
                .from(BUCKET)
                .upload(path, body, {
                    contentType: "image/webp",
                    upsert: true,
                    // Seconds, NOT a header — supabase-js prefixes `max-age=`.
                    cacheControl: "31536000",
                });

            if (uploadError) {
                console.error(`✗ ${path}: ${uploadError.message}`);
                ok = false;
            }
        }

        if (!ok) {
            failed++;
            continue;
        }

        before += source.length;
        after += hero.length + card.length;

        console.log(
            `✓ ${base} — ${kb(source.length)} png -> ${kb(hero.length)} + ${kb(
                card.length,
            )} webp`,
        );
    }

    if (before) {
        console.log(
            `\n${kb(before)} -> ${kb(after)} (${(before / after).toFixed(
                1,
            )}x smaller). Cards now draw the small variant instead of the full render.`,
        );
    }

    if (failed) console.log(`${failed} failed`);

    // Each pass is called from here rather than chained off the one before it:
    // `repointRows` returns early when it has nothing to do, and chaining meant
    // a stack that was already repointed silently skipped the hashing.
    await repointRows();
    await backfillThumbhashes();
}

/**
 * Point `recipes.image` at the WebP wherever the object now exists.
 *
 * Scoped to rows that actually have a converted sibling, so a dish this run
 * could not convert is left pointing at the picture it still has rather than at
 * one that was never written.
 */
async function repointRows() {
    const { data: objects } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { limit: 5000 });

    const converted = new Set(
        (objects ?? [])
            .filter((f) => f.name.endsWith(".webp") && !f.name.endsWith("_sm.webp"))
            .map((f) => f.name),
    );

    const { data: rows, error } = await supabaseAdmin
        .from("recipes")
        .select("id, image")
        .like("image", "%.png");

    if (error) throw new Error(`Could not read recipes: ${error.message}`);

    const stale = (rows ?? []).filter((row) => {
        const file = row.image?.split("/").pop()?.split("?")[0];

        return file ? converted.has(file.replace(/\.png$/, ".webp")) : false;
    });

    console.log(`\n=== recipes.image ===`);
    console.log(`${stale.length} rows still pointing at a converted .png`);

    if (dry || !stale.length) return;

    let moved = 0;

    for (const row of stale) {
        const { error: updateError } = await supabaseAdmin
            .from("recipes")
            // Swap the extension in place rather than rebuilding the URL: the
            // stored string carries whatever host wrote it, and this run has no
            // business changing that.
            .update({ image: row.image!.replace(/\.png(\?|$)/, ".webp$1") })
            .eq("id", row.id);

        if (updateError) {
            console.error(`✗ ${row.id}: ${updateError.message}`);
            continue;
        }

        moved++;
    }

    console.log(`✓ ${moved} rows repointed`);
}

/**
 * Fill `recipes.thumbhash` for every row that has a picture and no hash.
 *
 * Separate from the conversion pass because it applies to the WHOLE catalogue,
 * not just the legacy half: the column was added after most of these dishes
 * were generated, so a WebP recipe that was never a PNG still has no hash.
 *
 * It re-downloads the hero rather than reusing whatever the conversion pass
 * held, which costs a fetch per dish and keeps the two passes independent — a
 * stack whose objects were already converted still gets its hashes.
 */
async function backfillThumbhashes() {
    const { data: rows, error } = await supabaseAdmin
        .from("recipes")
        .select("id, image")
        .is("thumbhash", null)
        .not("image", "is", null);

    if (error) throw new Error(`Could not read recipes: ${error.message}`);

    const pending = rows ?? [];

    console.log(`\n=== recipes.thumbhash ===`);
    console.log(`${pending.length} rows without a hash`);

    if (dry || !pending.length) return;

    // One hash per PICTURE, not per row: a dish and its variants share an
    // illustration, so re-encoding it once per variant would be the same work
    // several times over for an identical answer.
    const byImage = new Map<string, string[]>();

    for (const row of pending) {
        const list = byImage.get(row.image!) ?? [];

        list.push(row.id);
        byImage.set(row.image!, list);
    }

    let hashed = 0;
    let failed = 0;

    for (const [image, ids] of byImage) {
        const file = image.split("/").pop()?.split("?")[0];

        if (!file) continue;

        const { data: blob, error: downloadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .download(file);

        if (!blob || downloadError) {
            console.error(`✗ ${file}: ${downloadError?.message ?? "missing"}`);
            failed++;
            continue;
        }

        const { thumbhash } = await encodeRecipeImageVariants(
            Buffer.from(await blob.arrayBuffer()),
        );

        const { error: updateError } = await supabaseAdmin
            .from("recipes")
            .update({ thumbhash })
            .in("id", ids);

        if (updateError) {
            console.error(`✗ ${file}: ${updateError.message}`);
            failed++;
            continue;
        }

        hashed += ids.length;
    }

    console.log(
        `✓ ${hashed} rows hashed from ${byImage.size} pictures${
            failed ? `, ${failed} failed` : ""
        }`,
    );
}

main();
