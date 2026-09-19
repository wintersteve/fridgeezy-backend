import "dotenv/config";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { encodeRecipeImageVariants } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Upload the app's fixed screen illustrations into `client_art`.
 *
 *   npx jiti operations/seed-client-art.ts
 *   npx jiti operations/seed-client-art.ts -- --force
 *
 * ## What these are
 *
 * Paintings that belong to a SCREEN rather than to a dish: the three state
 * discs `ArtMedallion` draws on locked and empty pages (`bowl`, `plate`,
 * `produce`) and the compose-menu card's band (`menu`). They are painted once by
 * `generate-client-art` and change about as often as the app's icon, so they are
 * seeded rather than drawn on demand the way a technique plate is.
 *
 * They shipped in the app bundle until 2026-09-18, which cost every reader
 * ~340 KB on download for pictures most of them will see one of.
 *
 * ## The five crash paintings are NOT here, and that is the point of the split
 *
 * `ErrorState`'s `crash` kind draws one of `onion`, `tomato`, `egg`, `carrot`
 * or `aubergine` when a screen has thrown. A picture shown *because something
 * broke* must not itself depend on a working network — a crash and a dead
 * connection arrive together often enough that this is the one illustration in
 * the app that cannot be allowed to fail. Those five stay in the binary, and
 * anything that moves them here has made the error screen's art conditional on
 * the thing most likely to be wrong.
 *
 * `ErrorState`'s `offline` kind draws a glyph rather than a painting, so it is
 * unaffected either way.
 */
const BUCKET = "client_art";
const SOURCE = join(process.cwd(), "operations", "data", "client-art");

const force = process.argv.includes("--force");

async function main() {
    const files = readdirSync(SOURCE).filter((f) => f.endsWith(".jpg"));

    console.log(`=== Seeding ${files.length} client illustrations ===`);
    console.log(`Stack: ${process.env.SUPABASE_URL}\n`);

    const { data: existing } = await supabaseAdmin.storage.from(BUCKET).list("");
    const present = new Set((existing ?? []).map((f) => f.name));

    let written = 0;
    let before = 0;
    let after = 0;

    for (const file of files) {
        const name = file.replace(/\.jpg$/, "");
        const path = `${name}.webp`;

        if (present.has(path) && !force) {
            console.log(`· ${name} — already present, skipping`);
            continue;
        }

        const source = readFileSync(join(SOURCE, file));

        // The hero's encoder, for its WebP settings. Its card variant and
        // thumbhash are discarded: these are drawn at one size and have no
        // placeholder of their own.
        const { hero } = await encodeRecipeImageVariants(source);

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, hero, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, NOT a header — supabase-js prefixes `max-age=`.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`✗ ${name}: ${error.message}`);
            continue;
        }

        before += source.length;
        after += hero.length;
        written++;

        console.log(
            `✓ ${name} — ${(source.length / 1024).toFixed(0)}K jpg -> ${(
                hero.length / 1024
            ).toFixed(0)}K webp`,
        );
    }

    if (written) {
        console.log(
            `\n${(before / 1024).toFixed(0)}K -> ${(after / 1024).toFixed(
                0,
            )}K, and none of it ships in the binary.`,
        );
    }
}

main();
