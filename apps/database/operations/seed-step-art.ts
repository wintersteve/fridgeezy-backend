import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeRecipeImageVariants } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Upload the one hand-made set of per-step illustrations into `recipe_step_art`.
 *
 *   npx jiti operations/seed-step-art.ts
 *   npx jiti operations/seed-step-art.ts -- --force
 *
 * ## What this is, and what it is not
 *
 * Tuna Tataki's seven steps and its gathering page were generated once by hand
 * to find out on a real device whether per-step art is worth what it costs. They
 * shipped in the app bundle — eight JPEGs, ~1.6 MB, downloaded by every reader
 * for one dish almost none of them will cook. This puts them where every other
 * generated picture in the app lives, so the binary carries none of it and a
 * phone fetches a step only if it reaches that step.
 *
 * It is NOT the generation path. `RECIPE_STEP_ART_ENABLED` gates that, it is
 * off, and it is off independently of this — the flag decides whether new art is
 * DRAWN, never whether existing art is shown. This set is shown either way.
 *
 * ## Keyed by step NUMBER, which is a repair rather than a translation
 *
 * The bundled version keyed on the step's TITLE, and its own note predicted the
 * failure this hit: "a recipe whose steps were regenerated would simply stop
 * matching". They were. Not one of the seven titles in the fixture
 * ("prepare the ponzu dressing") matches the row in the database today
 * ("Mix the ponzu dressing"), so on this stack the fixture had already gone
 * dark. The files are numbered in method order, so the order is what they are
 * mapped by.
 *
 * ## It picks the ORIGINAL, deliberately
 *
 * There are three rows named "Tuna Tataki" here — the catalogue dish and two
 * variants — and a variant rewrites the method while keeping the name. Step art
 * belongs to a METHOD, so seeding a variant's id would put pictures of the
 * original's steps over instructions that no longer describe them.
 */
const BUCKET = "recipe_step_art";
const SOURCE = join(process.cwd(), "operations", "data", "step-art");
const DISH = "Tuna Tataki";

const force = process.argv.includes("--force");

/** The files, in method order. `mise` is the gathering page, not a step. */
const STEPS = [
    "tuna-tataki-01.jpg",
    "tuna-tataki-02.jpg",
    "tuna-tataki-03.jpg",
    "tuna-tataki-04.jpg",
    "tuna-tataki-05.jpg",
    "tuna-tataki-06.jpg",
    "tuna-tataki-07.jpg",
];
const MISE = "tuna-tataki-mise.jpg";

async function upload(path: string, file: string): Promise<number | null> {
    const source = readFileSync(join(SOURCE, file));

    // The hero's encoder, for its WebP settings. The card variant and thumbhash
    // it also produces are discarded: a step band has one size and no
    // placeholder of its own.
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
        console.error(`✗ ${path}: ${error.message}`);

        return null;
    }

    console.log(
        `✓ ${path} — ${(source.length / 1024).toFixed(0)}K jpg -> ${(
            hero.length / 1024
        ).toFixed(0)}K webp`,
    );

    return hero.length;
}

async function main() {
    const { data: recipes, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name, base_recipe_id")
        .eq("name", DISH)
        .is("base_recipe_id", null);

    if (error) throw new Error(`Could not read recipes: ${error.message}`);

    const recipe = recipes?.[0];

    if (!recipe) {
        console.log(
            `No catalogue row named "${DISH}" on this stack — nothing to seed.`,
        );

        return;
    }

    const { data: steps } = await supabaseAdmin
        .from("recipe_instructions")
        .select("step_number")
        .eq("recipe_id", recipe.id)
        .order("step_number");

    console.log(`=== ${DISH} (${recipe.id}) ===`);
    console.log(`Stack: ${process.env.SUPABASE_URL}`);
    console.log(`${steps?.length ?? 0} steps in the database, ${STEPS.length} pictures\n`);

    const { data: existing } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(recipe.id);

    if (existing?.length && !force) {
        console.log("Already seeded. Pass --force to overwrite.");

        return;
    }

    // Zip the pictures onto the step numbers the database actually has, rather
    // than assuming 1..7: a method that lost a step should leave the tail
    // unillustrated instead of shifting every picture onto the wrong
    // instruction.
    const numbers = (steps ?? []).map((s) => s.step_number);
    let written = 0;

    for (const [index, file] of STEPS.entries()) {
        const stepNumber = numbers[index];

        if (!stepNumber) {
            console.log(`· ${file} — no step ${index + 1} in this method, skipped`);
            continue;
        }

        if (await upload(`${recipe.id}/${stepNumber}.webp`, file)) written++;
    }

    if (await upload(`${recipe.id}/mise.webp`, MISE)) written++;

    console.log(`\n${written} objects written`);
}

main();
