// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Puts a picture into the `art_direction` bucket, where it becomes part of what
 * every new dish is drawn to match.
 *
 * This is the command the bucket's migration promises: the set is a taste
 * decision that moves, so changing it has to be an upload rather than a deploy.
 *
 * ## It re-encodes, and that is the whole reason this is not two curl lines
 *
 * The first set was uploaded as the model returned it — two full-size JPEGs and
 * a WebP — and came to **1648 KB of base64 on every single generation
 * request**, for pictures the model samples down before it looks at them. At
 * 768px WebP the same three carry the same style for about a sixth of that.
 * A style anchor is the only image in this system that is an INPUT, so its file
 * size is a cost paid per dish forever rather than once.
 *
 * ## The slot is the position in the set
 *
 * `style-anchors.ts` lists the objects it reads, in order, and the name here has
 * to match one of them. Uploading under a name that file does not list writes an
 * object nothing will ever read; changing the set means editing that list too,
 * and that is deliberate — adding an anchor changes what the app believes its
 * style is, so it should show up in a diff.
 *
 * Usage:
 *   npx jiti operations/install-style-anchor.ts --slot=03-kiev.webp --file=path/to/picture.jpg
 */

const BUCKET = "art_direction";

/**
 * Wide enough that nothing about the style is lost, small enough that three of
 * them are a rounding error on a request. The model tiles and downsamples its
 * inputs, so pixels past this buy nothing at all.
 */
const ANCHOR_WIDTH = 768;
const ANCHOR_QUALITY = 82;

const arg = (name: string) =>
    process.argv
        .find((a) => a.startsWith(`--${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");

const SLOT = arg("slot");
const FILE = arg("file");

async function main() {
    if (!SLOT || !FILE) {
        console.error(
            "Usage: --slot=<name in style-anchors.ts> --file=<picture>"
        );
        process.exitCode = 1;
        return;
    }

    if (!SLOT.endsWith(".webp")) {
        console.error(`Slot must be a .webp name; got ${SLOT}`);
        process.exitCode = 1;
        return;
    }

    // Deferred exactly as `encodeRecipeImageVariants` defers it: a ~30 MB
    // native module that an operation doing nothing else should not load.
    const { default: sharp } = await import("sharp");

    const source = readFileSync(
        isAbsolute(FILE) ? FILE : join(process.cwd(), FILE)
    );

    const encoded = await sharp(source)
        .resize({ width: ANCHOR_WIDTH, withoutEnlargement: true })
        .webp({ quality: ANCHOR_QUALITY })
        .toBuffer();

    console.log(`Database: ${process.env.SUPABASE_URL ?? "(unset)"}`);
    console.log(`Slot:     ${BUCKET}/${SLOT}`);
    console.log(
        `Size:     ${Math.round(source.length / 1024)} KB → ${Math.round(encoded.length / 1024)} KB`
    );

    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(SLOT, encoded, {
            contentType: "image/webp",
            upsert: true,
        });

    if (error) {
        console.error("✗ upload failed:", error);
        process.exitCode = 1;
        return;
    }

    console.log(`✓ uploaded`);
    console.log(
        "\nIt takes effect on the next cold container — the anchors are cached " +
            "for the life of an execution environment, on purpose."
    );
}

void main();
