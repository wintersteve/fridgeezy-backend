import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

config();

/**
 * Dumps every table the ingredient cleanup mutates, as restorable JSON.
 *
 * `merge_ingredient` DELETES rows, and the cleanup runs as one transaction — so
 * the transaction protects you DURING the run and not one second after it
 * commits. This is the path back, and it has to be taken before the first
 * mutation rather than "at some point today".
 *
 * Every table here is one the merge writes to:
 *
 *   ingredients                     rows are deleted outright
 *   ingredient_aliases              moved, deleted, and one inserted per merge
 *   recipe_ingredients              repointed, summed, deleted
 *   recipe_suggestion_ingredients   repointed, deleted
 *   profile_blacklisted_ingredients repointed, deleted
 *   recipe_instructions             ingredient_refs rewritten in place
 *   ingredient_merge_reviews        seeded, and CASCADEs when a side is merged
 *
 * `recipe_instructions` is included because `ingredient_refs` is a uuid[] the
 * merge rewrites — that is a mutation of a table nobody thinks of as an
 * ingredient table, and it is the one most likely to be forgotten.
 *
 * Embeddings are excluded deliberately: they are large, they are regenerable by
 * `embed-ingredients`, and including them would make the dump ~15MB of numbers
 * nobody will read. The cost of that choice is that a restore must be followed
 * by a re-embed — which the cleanup requires anyway.
 *
 * Set `BACKUP_DIR` to choose where it lands.
 */

const TABLES = [
    "ingredients",
    "ingredient_aliases",
    "recipe_ingredients",
    "recipe_suggestion_ingredients",
    "profile_blacklisted_ingredients",
    "recipe_instructions",
    "ingredient_merge_reviews",
] as const;

/**
 * Columns skipped per table — big, regenerable, and unread by a restore.
 *
 * `name_ascii` is there for a second reason: it is a STORED GENERATED column,
 * so a restore that fed these rows straight back would not merely waste space,
 * it would be rejected. Postgres computes it from `name`.
 */
const SKIP_COLUMNS: Record<string, string[]> = {
    ingredients: ["embedding", "name_ascii"],
};

async function main() {
    const dir =
        process.env.BACKUP_DIR ??
        join(process.env.HOME ?? ".", "fridgeezy-backups", "ingredient-cleanup");
    mkdirSync(dir, { recursive: true });

    const { data: urlRow } = await supabaseAdmin
        .from("ingredients")
        .select("id", { count: "exact", head: true });
    void urlRow;

    console.log(`\nbacking up to: ${dir}`);
    console.log(`source: ${process.env.SUPABASE_URL}\n`);

    const manifest: Record<string, number> = {};

    for (const table of TABLES) {
        const rows: unknown[] = [];
        const pageSize = 500;
        let missing = false;

        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await supabaseAdmin
                .from(table)
                .select("*")
                .order("id")
                .range(offset, offset + pageSize - 1);

            if (error) {
                // A table the migration has not created yet is not a failure —
                // it simply has nothing to restore.
                console.log(`  ${table.padEnd(32)} (absent: ${error.message})`);
                missing = true;
                break;
            }
            if (!data || data.length === 0) break;

            for (const row of data) {
                const copy = { ...(row as Record<string, unknown>) };
                for (const column of SKIP_COLUMNS[table] ?? []) delete copy[column];
                rows.push(copy);
            }
            if (data.length < pageSize) break;
        }

        if (missing) continue;

        const file = join(dir, `${table}.json`);
        writeFileSync(file, JSON.stringify(rows, null, 2));
        manifest[table] = rows.length;
        console.log(`  ${table.padEnd(32)} ${String(rows.length).padStart(6)} rows`);
    }

    writeFileSync(
        join(dir, "MANIFEST.json"),
        JSON.stringify(
            {
                takenAt: new Date().toISOString(),
                source: process.env.SUPABASE_URL,
                note:
                    "Pre-cleanup dump for the ingredient duplicate merge. Embeddings " +
                    "excluded — re-run embed-ingredients after any restore.",
                counts: manifest,
            },
            null,
            2
        )
    );

    console.log(`\nmanifest written. ${Object.keys(manifest).length} table(s) captured.\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
