import { isPrivateHost } from "@fridgeezy/toolkit";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Repoints `recipes.image` at the storage host the database it lives in
 * actually serves from.
 *
 * ## The failure this exists for
 *
 * Found in production on 2026-09-23: **49 of 54 recipes** carried
 * `http://192.168.1.6:54321/storage/v1/object/public/recipes/<dish>.webp` — a
 * developer's LAN address, baked into the shared catalogue. Every share link on
 * the internet was serving that as its `og:image` AND as the page's `<img>`, so
 * every preview in iMessage, WhatsApp and Slack had been broken for as long as
 * the rows existed, and every one of them was plain `http://` besides.
 *
 * The bytes were never the problem. All 94 objects (47 dishes, hero plus card
 * variant) are in the production bucket under exactly the right keys, and
 * `greek_salad.webp` returns 200 and 66KB from the project's own origin. Only
 * the stored URL was wrong, which is what makes this a rewrite rather than a
 * regeneration.
 *
 * ## Where a LAN address comes from, since it cannot come from Lambda
 *
 * `toDeviceReachable` swaps loopback for the Mac's LAN IP on a storage URL
 * about to reach a phone, because on a real device `127.0.0.1` means THAT
 * DEVICE. It is a no-op in every deployed configuration by construction — the
 * Lambda's `SUPABASE_URL` is the project's https origin and has no loopback
 * host to match — so the API cannot have written these.
 *
 * It derives from `SUPABASE_URL`, so the host in the URL and the database being
 * written are always the same machine. A LAN URL therefore cannot be written
 * INTO production; it can only be **copied** there — a dump and restore, or a
 * seed built from a local stack. That is the failure mode to watch, and it is
 * invisible: the rows restore cleanly, and on the developer's own phone, on the
 * same LAN, the pictures load.
 *
 * ## Targeting
 *
 * `apps/database/.env` only ever holds LOCAL values, deliberately — a remote
 * value there is "one stray `embed-* --all` away from a production incident".
 * So this does not read the shared `supabaseAdmin` client: it builds its own
 * from an explicitly named target, and `--remote` is the only way to reach
 * production. The host is printed in every mode, including dry runs.
 *
 * SAFE BY DEFAULT: reports and writes nothing without `--apply`.
 *
 *   npx nx run @fridgeezy/database:repair-image-urls
 *   npx nx run @fridgeezy/database:repair-image-urls -- --remote
 *   npx nx run @fridgeezy/database:repair-image-urls -- --remote --apply
 */

const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");

/** Everything after this prefix is the object's key within its bucket. */
const PUBLIC_PREFIX = "/storage/v1/object/public/";

// `isPrivateHost` is imported from @fridgeezy/toolkit rather than written
// here: the admin console's overview counts exactly the rows this repairs, and
// two copies of the rule are two answers to one question. Its own doc carries
// why the test is private-vs-public rather than a comparison of two origins.

function resolveTarget(): { url: string; key: string } {
    // Loaded rather than read off `supabaseAdmin`, so the target is named by the
    // command rather than inherited from whatever a shell happens to export.
    const path = remote
        ? join(__dirname, "..", "..", "api", ".env.production")
        : join(__dirname, "..", ".env");

    if (!existsSync(path)) {
        throw new Error(
            `No ${path}. Run \`npx nx run @fridgeezy/database:env${remote ? "-remote" : ""}\` first.`
        );
    }

    const parsed = config({ path, processEnv: {} }).parsed ?? {};
    const url = parsed.SUPABASE_URL;
    const key = parsed.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error(`${path} is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    }

    // The one guard that matters, and it is about the ARGUMENT rather than the
    // file: `--remote` reaching a loopback host means the production env file
    // was generated locally, and the "repair" would then write LAN URLs over
    // whatever is there. Refuse rather than proceed.
    if (remote && /127\.0\.0\.1|localhost|192\.168\./.test(url)) {
        throw new Error(
            `--remote resolved to ${url}, which is not a remote stack. Run env-remote.`
        );
    }

    return { url, key };
}

async function main() {
    const { url, key } = resolveTarget();
    const expected = new URL(url).origin;

    // The condition for there being anything to repair AT ALL. A private host
    // is only damage in a database the public is served from; in a local stack
    // it is the intended value, and rewriting it would break image loading on
    // every physical device. Checked once, here, rather than folded into the
    // per-row test — where it reads as a detail and, on the first draft, was
    // simply missing: both hosts were private, their origins differed, and the
    // operation cheerfully offered to "repair" 50 correct rows.
    if (isPrivateHost(new URL(url).hostname)) {
        console.log(`recipe image URLs — local stack (${expected})\n`);
        console.log(
            "Nothing to repair: this database is not served publicly, so a\n" +
                "private storage host is the correct value here. Pass --remote to\n" +
                "check the deployed project."
        );
        return;
    }

    console.log(`recipe image URLs — ${remote ? "REMOTE" : "local"}`);
    console.log(`  target: ${expected}`);
    console.log(`  mode:   ${apply ? "APPLY (will write)" : "dry run"}\n`);

    const supabase = createClient(url, key);

    const { data: recipes, error } = await supabase
        .from("recipes")
        .select("id, name, image")
        .not("image", "is", null);

    if (error) throw new Error(`could not read recipes: ${error.message}`);

    const wrong = (recipes ?? []).filter((recipe) => {
        try {
            // The target is known public by the guard above, so any private
            // host here is unreachable by every reader of this database.
            return isPrivateHost(new URL(recipe.image as string).hostname);
        } catch {
            // An unparseable value is wrong in a way this cannot fix by
            // rewriting a host — reported below rather than silently skipped.
            return true;
        }
    });

    console.log(
        `${recipes?.length ?? 0} recipes with an image, ` +
            `${wrong.length} on a host the public cannot reach`
    );

    if (wrong.length === 0) {
        console.log("\nNothing to do.");
        return;
    }

    const repairs: { id: string; name: string; from: string; to: string }[] = [];
    const unfixable: { name: string; image: string; why: string }[] = [];

    for (const recipe of wrong) {
        const image = recipe.image as string;
        const index = image.indexOf(PUBLIC_PREFIX);

        if (index === -1) {
            unfixable.push({
                name: recipe.name,
                image,
                why: "not a public storage URL — no object key to keep",
            });
            continue;
        }

        // The KEY is preserved exactly; only the origin changes. Deriving the
        // filename from the dish's name instead would be a different operation
        // with a different failure mode — a renamed dish would be repointed at
        // an object that was never written.
        const objectKey = image.slice(index + PUBLIC_PREFIX.length);
        const [bucket, ...rest] = objectKey.split("/");
        const path = rest.join("/");
        const to = `${expected}${PUBLIC_PREFIX}${objectKey}`;

        // Proven present before the row is repointed. Rewriting a URL onto a
        // missing object trades a broken picture for a broken picture and makes
        // the damage HARDER to find later, because the host then looks right.
        //
        // `list` with a search term, which is what `create-recipe-image.ts`
        // itself uses. Not `download` with a 1x1 transform: image
        // transformation is a paid add-on and is absent from the local stack
        // entirely, so that check reported every object missing — including
        // ones sitting right there.
        const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const filename = path.slice(path.lastIndexOf("/") + 1);

        const { data: matches } = await supabase.storage
            .from(bucket)
            .list(directory, { search: filename, limit: 100 });

        if (!matches?.some((object) => object.name === filename)) {
            unfixable.push({
                name: recipe.name,
                image,
                why: `no object at ${objectKey} — regenerate its illustration instead`,
            });
            continue;
        }

        repairs.push({ id: recipe.id, name: recipe.name, from: image, to });
    }

    console.log(`\n${repairs.length} can be repointed:`);
    for (const repair of repairs.slice(0, 8)) {
        console.log(`  ${repair.name}`);
        console.log(`    ${repair.from}`);
        console.log(`      → ${repair.to}`);
    }
    if (repairs.length > 8) console.log(`  … and ${repairs.length - 8} more`);

    if (unfixable.length) {
        console.log(`\n${unfixable.length} cannot:`);
        for (const item of unfixable) console.log(`  ✗ ${item.name} — ${item.why}`);
    }

    if (!apply) {
        console.log(`\nDry run. Re-run with --apply to write ${repairs.length} row(s).`);
        return;
    }

    let written = 0;

    for (const repair of repairs) {
        // One row at a time rather than an upsert of the batch: an upsert needs
        // every NOT NULL column of the row, so it would have to re-send data it
        // never read, and a partial failure would be a partial rewrite of the
        // catalogue rather than of one column.
        const { error: updateError } = await supabase
            .from("recipes")
            .update({ image: repair.to })
            .eq("id", repair.id);

        if (updateError) {
            console.error(`  ✗ ${repair.name}: ${updateError.message}`);
            continue;
        }

        written += 1;
    }

    console.log(`\nRepointed ${written} of ${repairs.length}.`);

    if (written !== repairs.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
