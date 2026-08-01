import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Load a curated ingredient seed into the catalog: ingredients (with the
 * singular/plural-collapsing canonical_id, a resolved category, and an
 * embedding) plus their aliases. Pre-warms the direct-match + alias path so the
 * common case never pays the vector/LLM cold-start.
 *
 * Reads a JSON array of { name, category, aliases? } where `category` is a
 * category canonical_id (one of the 20 seeded categories).
 *
 * DRY RUN by default — set SEED_APPLY=true to write. Idempotent and safe to
 * re-run after extending the dataset:
 *   - ingredients already in the catalog (by canonical_id) are never recreated
 *   - they ARE enriched: description, shelf life, storage tips and category are
 *     filled where the row has nothing and the seed has something. Never
 *     overwritten, since the catalog is also edited by the app and by hand.
 *   - existing aliases are skipped
 */
const APPLY = process.env.SEED_APPLY === "true";
const SEED_FILE = process.env.SEED_FILE ?? "src/scripts/data/ingredient-seed.json";
const EMBED_MODEL = "text-embedding-3-small" as const;
const EMBED_DIMS = 1536;
const EMBED_CHUNK = 256;

interface SeedIngredient {
    name: string;
    category: string;
    aliases?: string[];
    /**
     * Optional catalog metadata, carried over from the legacy SQL seed when it
     * was merged into this file. Present on 384 of the entries; absent entries
     * simply leave the columns null.
     */
    description?: string;
    shelfLife?: string;
    storageTips?: string;
}

// Ingredient identity — shared with match-ingredients.ts and mirrored by the
// SQL ingredient_canonical_id, which produced the stored canonical_id.
const toCanonicalId = ingredientCanonicalId;

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function main() {
    const path = join(process.cwd(), SEED_FILE);
    const seeds: SeedIngredient[] = JSON.parse(readFileSync(path, "utf8"));
    console.log(`Loaded ${seeds.length} seed rows from ${SEED_FILE}\n`);

    // 1. Category canonical_id -> id.
    const { data: cats, error: catErr } = await supabaseAdmin
        .from("categories")
        .select("id, canonical_id");
    if (catErr) throw new Error(catErr.message);
    const catByCanonical = new Map(
        (cats ?? []).map((c) => [c.canonical_id as string, c.id as string])
    );

    const unknownCats = [
        ...new Set(seeds.map((s) => s.category).filter((c) => !catByCanonical.has(c))),
    ];
    if (unknownCats.length > 0) {
        console.error(
            `Unknown category canonical_ids in seed (not in DB): ${unknownCats.join(", ")}`
        );
        process.exit(1);
    }

    // 2. Dedupe seed rows by canonical_id (first wins).
    const byCanonical = new Map<string, SeedIngredient>();
    for (const s of seeds) {
        const cid = toCanonicalId(s.name);
        if (cid && !byCanonical.has(cid)) byCanonical.set(cid, s);
    }

    // 3. Which canonicals already exist, and what metadata they are missing.
    const canonicalIds = [...byCanonical.keys()];
    const existingByCanonical = new Map<string, string>();
    interface ExistingRow {
        id: string;
        description: string | null;
        shelf_life: string | null;
        storage_tips: string | null;
        category_id: string | null;
    }
    const existingRowByCanonical = new Map<string, ExistingRow>();
    for (const ids of chunk(canonicalIds, 500)) {
        const { data: rows, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, canonical_id, description, shelf_life, storage_tips, category_id")
            .in("canonical_id", ids);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
            existingByCanonical.set(r.canonical_id as string, r.id as string);
            existingRowByCanonical.set(r.canonical_id as string, r as ExistingRow);
        }
    }

    const toCreate = [...byCanonical.entries()].filter(
        ([cid]) => !existingByCanonical.has(cid)
    );

    /**
     * Rows that exist but are missing something the seed can supply.
     *
     * FILL-ONLY, never overwrite. The live catalog is edited by the app and by
     * hand; a seed re-run must not stamp its own version over a description
     * someone improved. So a field is written only where the row currently has
     * nothing and the seed has something.
     *
     * This exists because the script used to be insert-only: 466 seed entries
     * carry metadata but only the newly created rows ever received it, leaving
     * everything already in the catalog permanently blank.
     */
    const toEnrich: { id: string; patch: Record<string, string> }[] = [];
    for (const [cid, s] of byCanonical) {
        const row = existingRowByCanonical.get(cid);
        if (!row) continue;

        const patch: Record<string, string> = {};
        if (s.description && !row.description) patch.description = s.description;
        if (s.shelfLife && !row.shelf_life) patch.shelf_life = s.shelfLife;
        if (s.storageTips && !row.storage_tips) patch.storage_tips = s.storageTips;

        // A category the seed knows and the row lacks — same fill-only rule.
        const seedCategoryId = catByCanonical.get(s.category);
        if (seedCategoryId && !row.category_id) patch.category_id = seedCategoryId;

        if (Object.keys(patch).length > 0) toEnrich.push({ id: row.id, patch });
    }

    console.log(
        `Unique: ${byCanonical.size} | already in catalog: ${existingByCanonical.size} | to create: ${toCreate.length} | to enrich: ${toEnrich.length}${APPLY ? "" : " — DRY RUN"}`
    );

    if (!APPLY) {
        console.log("\nSample of new ingredients:");
        for (const [cid, s] of toCreate.slice(0, 15)) {
            console.log(
                `  ${cid.padEnd(24)} [${s.category}]  aliases: ${(s.aliases ?? []).join(", ") || "—"}`
            );
        }
        if (toEnrich.length) {
            const fields = new Map<string, number>();
            for (const { patch } of toEnrich)
                for (const k of Object.keys(patch))
                    fields.set(k, (fields.get(k) ?? 0) + 1);
            console.log("\nFields that would be filled on existing rows:");
            for (const [field, n] of [...fields].sort())
                console.log(`  ${field.padEnd(14)} ${n}`);
        }
        console.log("\nDRY RUN — set SEED_APPLY=true to write.");
        return;
    }

    // 3b. Fill the blanks on existing rows. One statement each: the patches
    // differ per row, and an upsert would need every NOT NULL column this
    // script never reads.
    if (toEnrich.length) {
        console.log(`\nEnriching ${toEnrich.length} existing ingredients...`);
        let enriched = 0;
        for (const { id, patch } of toEnrich) {
            const { error } = await supabaseAdmin
                .from("ingredients")
                .update(patch as never)
                .eq("id", id);
            if (error) {
                console.error(`  ${id}: ${error.message}`);
                continue;
            }
            enriched++;
        }
        console.log(`Enriched ${enriched}/${toEnrich.length}.`);
    }

    // 4. Batch-embed the new ingredient names.
    console.log(`\nEmbedding ${toCreate.length} names (${EMBED_MODEL})...`);
    const embeddingByCanonical = new Map<string, number[]>();
    for (const batch of chunk(toCreate, EMBED_CHUNK)) {
        const names = batch.map(([, s]) => s.name);
        const { embeddings } = await generateBatchEmbeddings(names, {
            model: EMBED_MODEL,
            dimensions: EMBED_DIMS,
        });
        batch.forEach(([cid], i) => embeddingByCanonical.set(cid, embeddings[i]));
    }

    // 5. Insert ingredients (skip any that lost a race on canonical/name).
    console.log(`Inserting ${toCreate.length} ingredients...`);
    const idByCanonical = new Map<string, string>(existingByCanonical);
    let created = 0;
    for (const batch of chunk(toCreate, 200)) {
        const rows = batch.map(([cid, s]) => ({
            name: s.name,
            canonical_id: cid,
            category_id: catByCanonical.get(s.category),
            embedding: JSON.stringify(embeddingByCanonical.get(cid)),
            // Omitted rather than written as null when absent, so a partial
            // seed never blanks a column that already holds something.
            ...(s.description ? { description: s.description } : {}),
            ...(s.shelfLife ? { shelf_life: s.shelfLife } : {}),
            ...(s.storageTips ? { storage_tips: s.storageTips } : {}),
        }));
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .insert(rows)
            .select("id, canonical_id");
        if (error) {
            console.error(`  insert batch failed: ${error.message}`);
            continue;
        }
        for (const r of data ?? []) {
            idByCanonical.set(r.canonical_id as string, r.id as string);
            created++;
        }
    }
    console.log(`Created ${created} ingredients.`);

    // 6. Insert aliases (globally unique; skip the ingredient's own name and any
    // collision). Covers all seed rows, not just newly created ones.
    const aliasRows: { ingredient_id: string; alias: string }[] = [];
    const seenAlias = new Set<string>();
    for (const [cid, s] of byCanonical) {
        const ingredientId = idByCanonical.get(cid);
        if (!ingredientId) continue;
        for (const alias of s.aliases ?? []) {
            const a = alias.trim();
            if (!a) continue;
            if (toCanonicalId(a) === cid) continue; // same as the name itself
            const key = a.toLowerCase();
            if (seenAlias.has(key)) continue;
            seenAlias.add(key);
            aliasRows.push({ ingredient_id: ingredientId, alias: a });
        }
    }

    console.log(`\nInserting ${aliasRows.length} aliases...`);
    let aliasCreated = 0;
    for (const batch of chunk(aliasRows, 200)) {
        const { data, error } = await supabaseAdmin
            .from("ingredient_aliases")
            .upsert(batch, { onConflict: "alias", ignoreDuplicates: true })
            .select("id");
        if (error) {
            console.error(`  alias batch failed: ${error.message}`);
            continue;
        }
        aliasCreated += (data ?? []).length;
    }
    console.log(`Created ${aliasCreated} aliases (existing ones skipped).`);

    console.log("\nDone.");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\nSeed failed:", err);
        process.exit(1);
    });
