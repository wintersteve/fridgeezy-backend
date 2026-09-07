import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

import { parseShelfLife } from "./shelf-life-rule";

config();

/**
 * Turns `ingredients.shelf_life` — a sentence — into the two columns the fridge
 * actually reads, and does it deterministically: no model, no embeddings, no
 * spend.
 *
 * ## What it is for
 *
 * `expires_by_default` and `default_shelf_life_days` have existed since
 * `20260801000005` and 45 of 1041 rows carry a number. 360 rows carry the
 * SENTENCE and no number, which is the same as saying nothing at all to
 * anything that reads the columns — and everything fridge-shaped reads them:
 * a pantry item's confidence decays on its ingredient's shelf life, so without
 * a number every ingredient decays on one flat default and a bag of spinach is
 * treated like a jar of cumin.
 *
 * ## The rule
 *
 * **The FIRST duration clause, at its LOW end.**
 *
 * First clause, because these sentences are written fresh-state first: "1-2
 * days refrigerated, 3 months frozen" is a bag of spinach, not a freezer. Take
 * the last clause and every perishable in the catalogue becomes a store
 * cupboard item.
 *
 * Low end, because of which way the two mistakes fail. Confidence DECAYS and
 * never deletes, so an early "still got this?" costs one tap on the pantry
 * screen; a late one means the feed ranked a dish around an onion that went in
 * the bin last week. Asking sooner is the recoverable error.
 *
 * `Indefinite` maps to `expires_by_default = false` with a null number — the
 * case the table's own check constraint was written for.
 *
 * A row whose sentence carries no number at all ("Several months refrigerated")
 * is LEFT ALONE and printed. One row in the catalogue as of 2026-09-04, and a
 * wrong guess there is worse than the flat default it falls back to.
 *
 * ## Idempotent
 *
 * Only rows with a sentence and no number are touched, so the 45 already
 * populated (and anything a later run has already done) are skipped rather than
 * recomputed. Re-running writes nothing.
 *
 * DRY RUN unless `BACKFILL_SHELF_LIFE_APPLY=true`.
 */
const APPLY = process.env.BACKFILL_SHELF_LIFE_APPLY === "true";

interface Row {
    id: string;
    name: string;
    shelf_life: string | null;
    default_shelf_life_days: number | null;
}

async function main() {
    const rows: Row[] = [];

    // PostgREST caps a response at 1000 rows and the catalogue is past that.
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, name, shelf_life, default_shelf_life_days")
            .order("id")
            .range(offset, offset + 999);

        if (error || !data) {
            console.error("[ShelfLife] Failed to read ingredients:", error);
            process.exit(1);
        }

        rows.push(...(data as Row[]));
        if (data.length < 1000) break;
    }

    const todo = rows.filter(
        (row) => row.shelf_life && row.default_shelf_life_days === null
    );

    const expiring: Array<{ row: Row; days: number }> = [];
    const keeps: Row[] = [];
    const unreadable: Row[] = [];

    for (const row of todo) {
        const parsed = parseShelfLife(row.shelf_life as string);

        if (!parsed) unreadable.push(row);
        else if (parsed.expires) expiring.push({ row, days: parsed.days! });
        else keeps.push(row);
    }

    console.log(
        `${rows.length} ingredients, ${todo.length} with a sentence and no number` +
            `${APPLY ? "" : " — DRY RUN, nothing will be written"}\n`
    );

    console.log(
        `  ${expiring.length} get a shelf life, ${keeps.length} keep indefinitely, ` +
            `${unreadable.length} unreadable\n`
    );

    // Grouped, because 347 individual lines is not a thing anybody reads, and
    // the distribution is what a reviewer needs to sanity-check the rule: a
    // bucket in the wrong place is visible here and invisible row by row.
    const byDays = new Map<number, string[]>();
    for (const { row, days } of expiring) {
        const names = byDays.get(days) ?? [];
        names.push(row.name);
        byDays.set(days, names);
    }

    for (const [days, names] of [...byDays].sort((a, b) => a[0] - b[0])) {
        console.log(
            `  ${String(days).padStart(5)}d  ${names.length.toString().padStart(3)} ` +
                `e.g. ${names.slice(0, 4).join(", ")}`
        );
    }

    if (unreadable.length > 0) {
        console.log("\n  Left alone — no duration in the sentence:");
        for (const row of unreadable) {
            console.log(`    ${row.name}: ${JSON.stringify(row.shelf_life)}`);
        }
    }

    if (!APPLY) return;

    console.log("\nWriting…");

    let written = 0;

    // One statement per row. The two columns are bound by a CHECK constraint
    // (`expires_by_default = true` requires `default_shelf_life_days > 0`), so
    // they have to move together — which rules out the obvious two bulk updates.
    for (const { row, days } of expiring) {
        const { error } = await supabaseAdmin
            .from("ingredients")
            .update({ expires_by_default: true, default_shelf_life_days: days })
            .eq("id", row.id);

        if (error) console.error(`  FAILED ${row.name}: ${error.message}`);
        else written++;
    }

    // `Indefinite` rows are already `false`/null by the column default, so this
    // writes nothing — stated rather than skipped, because "the default happens
    // to be right" is a fact about today's schema and not a rule.
    console.log(
        `  ${written}/${expiring.length} shelf lives written; ` +
            `${keeps.length} indefinite rows already correct by default`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
