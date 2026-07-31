import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * One-time (re-runnable) cleanup that collapses duplicate NON-variant recipes —
 * rows that share a canonical_id (identical name) but are separate recipes. This
 * must be run before the partial unique index on recipes(canonical_id) can be
 * added (a follow-up migration). Each duplicate group is folded into its oldest
 * member via the merge_recipe RPC (which atomically repoints every reference).
 *
 * Unlike ingredient dedup, this is an EXACT canonical_id match — no embeddings or
 * LLM needed, since a duplicate recipe is literally the same name.
 *
 * DRY RUN by default — set DEDUP_APPLY=true to actually perform the merges.
 *
 * Requires the 20260729000001 migration (canonical_id column + merge_recipe) to
 * be applied first.
 */
const APPLY = process.env.DEDUP_APPLY === "true";

interface Recipe {
    id: string;
    name: string;
    canonical_id: string;
    created_at: string;
}

async function main() {
    // Only NON-variant recipes participate — variants (base_recipe_id set) share
    // names with their base by design.
    const { data: recipes, error } = await (supabaseAdmin as any)
        .from("recipes")
        .select("id, name, canonical_id, created_at")
        .is("base_recipe_id", null)
        .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!recipes || recipes.length === 0) {
        console.log("No recipes found. Nothing to do!");
        return;
    }

    console.log(
        `Scanning ${recipes.length} non-variant recipes for duplicate names${APPLY ? "" : " — DRY RUN"}...\n`
    );

    // Group by canonical_id (oldest first, since the query is ordered asc).
    const groups = new Map<string, Recipe[]>();
    for (const r of recipes as Recipe[]) {
        const bucket = groups.get(r.canonical_id) ?? [];
        bucket.push(r);
        groups.set(r.canonical_id, bucket);
    }

    const merges: Array<{ from: Recipe; into: Recipe }> = [];
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        const [keeper, ...dups] = members; // oldest kept
        if (!keeper) continue;
        for (const dup of dups) merges.push({ from: dup, into: keeper });
    }

    console.log(`Duplicate groups: ${[...groups.values()].filter((m) => m.length > 1).length}`);
    console.log(`Proposed merges: ${merges.length}`);
    for (const { from, into } of merges) {
        console.log(
            `  merge "${from.name}" (${from.id}) → "${into.name}" (${into.id})`
        );
    }

    if (!APPLY) {
        console.log(
            "\nDRY RUN — set DEDUP_APPLY=true to execute the merges above."
        );
        return;
    }

    console.log(`\nApplying ${merges.length} merges via merge_recipe...`);
    let ok = 0;
    let fail = 0;
    for (const { from, into } of merges) {
        const { error: mergeError } = await (supabaseAdmin.rpc as any)(
            "merge_recipe",
            { p_from: from.id, p_into: into.id }
        );
        if (mergeError) {
            console.error(
                `  ✗ "${from.name}" → "${into.name}": ${mergeError.message}`
            );
            fail++;
        } else {
            console.log(`  ✓ "${from.name}" → "${into.name}"`);
            ok++;
        }
    }

    console.log(`\nMerged: ${ok}, failed: ${fail}`);
    if (fail > 0) process.exit(1);
}

main()
    .then(() => {
        console.log("\nDone.");
        process.exit(0);
    })
    .catch((err) => {
        console.error("\nScript failed:", err);
        process.exit(1);
    });
