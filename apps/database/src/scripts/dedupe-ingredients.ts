import { generateEmbedding, openai } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * One-time (re-runnable) cleanup that dedupes the existing ingredient catalog:
 * finds near-duplicate rows (vector similarity >= DUP_THRESHOLD, confirmed by the
 * LLM), clusters them, and folds each cluster into its oldest member via the
 * merge_ingredient RPC (which atomically repoints every reference).
 *
 * DRY RUN by default — set DEDUP_APPLY=true to actually perform the merges.
 *
 * Note: O(N) embeddings + searches and up to ~5N LLM confirmations; intended for
 * periodic cleanup on a modest catalog, not a hot path.
 */
const DUP_THRESHOLD = 0.9;
const APPLY = process.env.DEDUP_APPLY === "true";

interface Ing {
    id: string;
    name: string;
    canonical_id: string;
    created_at: string;
}

/** LLM confirmation. Fails closed (false) so an error never merges anything. */
async function areSame(a: string, b: string): Promise<boolean> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Are A and B the same culinary ingredient — a synonym, regional name, or spelling/format variant (e.g. "spring onion" vs "scallion")? Different specificities of the same base (e.g. "olive oil" vs "extra virgin olive oil") are NOT the same. Respond with a single JSON object: {"same": true|false}.`,
                },
                { role: "user", content: `A: ${a}\nB: ${b}` },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 10,
        });
        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return false;
        return (JSON.parse(content) as { same?: boolean }).same === true;
    } catch {
        return false;
    }
}

async function main() {
    const { data: ingredients, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, name, canonical_id, created_at")
        .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!ingredients || ingredients.length === 0) {
        console.log("No ingredients found. Nothing to do!");
        return;
    }

    console.log(
        `Scanning ${ingredients.length} ingredients for duplicates (threshold ${DUP_THRESHOLD})${APPLY ? "" : " — DRY RUN"}...\n`
    );

    const byId = new Map<string, Ing>(
        ingredients.map((i) => [i.id, i as Ing])
    );

    // Union-find over ingredient ids.
    const parent = new Map<string, string>();
    ingredients.forEach((i) => parent.set(i.id, i.id));
    const find = (x: string): string => {
        let root = x;
        let next = parent.get(root);
        while (next !== undefined && next !== root) {
            root = next;
            next = parent.get(root);
        }
        return root;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));

    let pairsChecked = 0;
    let confirmed = 0;

    for (const ing of ingredients) {
        let embedding: number[];
        try {
            embedding = await generateEmbedding(ing.name);
        } catch {
            continue;
        }

        const { data: matches } = await supabaseAdmin.rpc(
            "search_ingredients",
            {
                query_embedding: JSON.stringify(embedding),
                match_threshold: DUP_THRESHOLD,
                match_count: 5,
            }
        );
        if (!matches) continue;

        for (const m of matches as Array<{
            id: string;
            name: string;
            similarity: number;
        }>) {
            if (m.id === ing.id) continue;
            if (m.similarity < DUP_THRESHOLD) continue;
            if (find(ing.id) === find(m.id)) continue;

            pairsChecked++;
            if (await areSame(ing.name, m.name)) {
                confirmed++;
                union(ing.id, m.id);
                console.log(
                    `  ~ "${ing.name}" ≈ "${m.name}" (${m.similarity.toFixed(3)}) → merge`
                );
            }
        }
    }

    // Build clusters and propose merges (keep the oldest member as canonical).
    const clusters = new Map<string, Ing[]>();
    for (const i of ingredients) {
        const root = find(i.id);
        const bucket = clusters.get(root) ?? [];
        const ing = byId.get(i.id);
        if (ing) bucket.push(ing);
        clusters.set(root, bucket);
    }

    const merges: Array<{ from: Ing; into: Ing }> = [];
    for (const members of clusters.values()) {
        if (members.length < 2) continue;
        const [canonical, ...dups] = members; // oldest first (query ordered asc)
        if (!canonical) continue;
        for (const dup of dups) merges.push({ from: dup, into: canonical });
    }

    console.log(`\nPairs confirmed same: ${confirmed}/${pairsChecked}`);
    console.log(`Proposed merges: ${merges.length}`);
    for (const { from, into } of merges) {
        console.log(`  merge "${from.name}" → "${into.name}"`);
    }

    if (!APPLY) {
        console.log(
            "\nDRY RUN — set DEDUP_APPLY=true to execute the merges above."
        );
        return;
    }

    console.log(`\nApplying ${merges.length} merges via merge_ingredient...`);
    let ok = 0;
    let fail = 0;
    for (const { from, into } of merges) {
        // merge_ingredient isn't in the generated types yet (new RPC).
        const { error: mergeError } = await (supabaseAdmin.rpc as any)(
            "merge_ingredient",
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
