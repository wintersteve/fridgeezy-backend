import "dotenv/config";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { normaliseGround } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Upload the REVIEWED technique illustrations into a stack's `technique_art`
 * bucket.
 *
 *   npx jiti operations/seed-technique-art.ts
 *   npx jiti operations/seed-technique-art.ts -- --force
 *
 * ## Why these are in the repo at all, when the rest are not
 *
 * Every other technique picture is drawn on demand by
 * `/rest/techniques/illustrate` and exists only in storage — there is nothing
 * to seed, because the first person to ask creates it. These seven are
 * different in one way that matters: **a person looked at them**, and in two
 * cases chose something the generator would not produce again.
 *
 * `blanch` is the clearest example. It is a hard-seamed diptych, a pan fused to
 * a bowl of iced water, and the scene prompt now explicitly forbids exactly
 * that shape because an unsupervised model draws a panel when it gives up on
 * composing one scene. It was kept because it came out better than the rule
 * allows. Ask the route for `blanch` on a fresh stack and you get the compliant,
 * seamless version instead — so without this file that picture is simply gone.
 *
 * So the JPEGs beside this script are the source of truth for the reviewed set,
 * and this is how they reach a database. **They are not shipped in the app
 * bundle**: the client reads every technique picture from storage, the same as
 * it reads recipe illustrations, so a phone downloads only the handful of verbs
 * its reader actually asks about.
 *
 * ## It goes through the same correction the route does
 *
 * Not a raw upload. `normaliseGround` maps each picture's ground onto `#FFFFFF`
 * and encodes WebP at the same quality, so a seeded plate and a generated one
 * are the same kind of object — which is what lets the client paint one flat
 * backdrop colour behind all of them.
 */
const BUCKET = "technique_art";
const SOURCE = join(process.cwd(), "operations", "data", "technique-art");

const force = process.argv.includes("--force");

async function main() {
    const files = readdirSync(SOURCE).filter((f) => f.endsWith(".jpg"));

    console.log(`=== Seeding ${files.length} reviewed technique plates ===`);
    console.log(`Stack: ${process.env.SUPABASE_URL}\n`);

    const { data: existing } = await supabaseAdmin.storage.from(BUCKET).list("");
    const present = new Set((existing ?? []).map((f) => f.name));

    let written = 0;
    let skipped = 0;

    for (const file of files) {
        const action = file.replace(/\.jpg$/, "");
        const path = `${action}.webp`;

        // A generated plate for the same verb is NOT overwritten by default.
        // Somebody may have asked the route for it since, and silently
        // replacing that with the seed would undo a deliberate re-draw.
        if (present.has(path) && !force) {
            console.log(`· ${action} — already present, skipping`);
            skipped++;
            continue;
        }

        const source = readFileSync(join(SOURCE, file));
        const { image, before, gains } = await normaliseGround(source);

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, image, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, NOT a header — supabase-js prefixes `max-age=`.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`✗ ${action}: ${error.message}`);
            continue;
        }

        console.log(
            `✓ ${action} — ${before} -> #FFFFFF, gains ${gains
                .map((g) => g.toFixed(3))
                .join("/")}, ${(source.length / 1024).toFixed(0)}K jpg -> ${(
                image.length / 1024
            ).toFixed(0)}K webp`,
        );
        written++;
    }

    console.log(`\n${written} written, ${skipped} skipped`);
    if (skipped && !force) console.log("Pass --force to overwrite.");
}

main();
