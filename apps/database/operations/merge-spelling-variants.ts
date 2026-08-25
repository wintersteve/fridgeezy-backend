import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Collapses ingredient rows that are the SAME WORD spelled two ways, and does
 * it deterministically — no embeddings, no LLM, no cost.
 *
 * ## The gap it closes
 *
 * `ingredient_canonical_id` singularises only the LAST word of a name
 * (`20260801000016`), which is what stops "Tomatoes" becoming a second
 * "Tomato". A compound whose EARLIER word carries the plural slips straight
 * through: `Brussels Sprout` -> `brussels_sprout` and `Brussel Sprout` ->
 * `brussel_sprout` are two identities for one vegetable, and nothing in the
 * write path can tell them apart.
 *
 * That is not a cosmetic duplicate. `find_recipes` filters by ingredient ID, so
 * a catalogue split across two rows answers an ingredient question with a
 * fraction of what it holds: measured 2026-08-24, 17 brussels-sprouts dishes in
 * the catalogue and a search for one of the two ids returned 3.
 *
 * ## Why it is separate from `dedupe-ingredients`
 *
 * That one hunts SYNONYMY — "scallion" and "green onion", different words for
 * one thing — which only a model can judge, so it costs O(N) embeddings plus up
 * to 5N confirmations and is run on suspicion. This is a string rule with a
 * proven false-positive story, so it is free and safe to run routinely. Run this
 * first; it is the cheap half and it is the half that recurs.
 *
 * DRY RUN unless `MERGE_VARIANTS_APPLY=true`.
 */
const APPLY = process.env.MERGE_VARIANTS_APPLY === "true";

interface Ing {
    id: string;
    name: string;
    canonical_id: string;
    created_at: string;
}

/**
 * The canonical id with every NON-FINAL word singularised.
 *
 * Only non-final, because the final word is already singularised by the SQL
 * rule — repeating it here would find nothing. `length > 3` keeps the rule off
 * short words where a trailing "s" is usually part of the word rather than a
 * plural ("miso", "hummus" and friends are single words anyway, but "gas_" or
 * "cos_" style stems are not worth the risk for a rule that runs unattended).
 */
const depluraliseNonFinal = (canonicalId: string): string => {
    const parts = canonicalId.split("_");
    if (parts.length < 2) return canonicalId;

    const head = parts
        .slice(0, -1)
        .map((word) =>
            word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word
        );

    return [...head, parts[parts.length - 1]].join("_");
};

/** How many rows point at this ingredient. Decides which side of a pair wins. */
async function referenceCount(id: string): Promise<number> {
    const [recipes, suggestions] = await Promise.all([
        supabaseAdmin
            .from("recipe_ingredients")
            .select("recipe_id", { count: "exact", head: true })
            .eq("ingredient_id", id),
        supabaseAdmin
            .from("recipe_suggestion_ingredients")
            .select("recipe_suggestion_id", { count: "exact", head: true })
            .eq("ingredient_id", id),
    ]);

    return (recipes.count ?? 0) + (suggestions.count ?? 0);
}

async function main() {
    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, name, canonical_id, created_at");

    if (error || !data) {
        console.error("[MergeVariants] Failed to read ingredients:", error);
        process.exit(1);
    }

    const rows = data as Ing[];
    const byCanonical = new Map(rows.map((row) => [row.canonical_id, row]));

    // Each pair once: only look from the pluralised side at its singular twin,
    // so a pair is never reported in both directions.
    const pairs: Array<[Ing, Ing]> = [];
    for (const row of rows) {
        const singular = depluraliseNonFinal(row.canonical_id);
        if (singular === row.canonical_id) continue;

        const twin = byCanonical.get(singular);
        if (twin) pairs.push([row, twin]);
    }

    console.log(
        `${rows.length} ingredients, ${pairs.length} spelling-variant pair(s)${
            APPLY ? "" : " — DRY RUN, nothing will be written"
        }\n`
    );

    for (const [a, b] of pairs) {
        const [countA, countB] = await Promise.all([
            referenceCount(a.id),
            referenceCount(b.id),
        ]);

        // Most-referenced wins, oldest breaks a tie. Reference count rather than
        // "the correct spelling" because this runs unattended and the catalogue
        // is the only evidence available — the row the data actually uses is the
        // one that costs least to keep, whatever a human would have picked.
        const keepA =
            countA !== countB ? countA > countB : a.created_at <= b.created_at;
        const keep = keepA ? a : b;
        const drop = keepA ? b : a;
        const dropCount = keepA ? countB : countA;

        console.log(
            `  ${drop.name} (${dropCount} refs) -> ${keep.name} (${keepA ? countA : countB} refs)`
        );

        if (!APPLY) continue;

        const merged = await supabaseAdmin.rpc("merge_ingredient", {
            p_from: drop.id,
            p_into: keep.id,
        });

        if (merged.error) {
            console.error(`     FAILED: ${merged.error.message}`);
            continue;
        }

        // `merge_ingredient` leaves the losing name behind as an alias, which is
        // what stops the row being recreated: the next "brussel sprouts" resolves
        // through `findByAliasCanonicalIds` instead of falling through to a
        // create.
        console.log(`     merged; "${drop.name}" kept as an alias`);
    }

    if (pairs.length === 0) console.log("  nothing to do");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
