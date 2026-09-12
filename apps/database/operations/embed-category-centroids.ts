import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Write each category's vector as the CENTROID of its curated member
 * ingredients, rather than the embedding of its own name.
 *
 * ## What this fixes
 *
 * `matchIngredients` files a newly created ingredient by nearest category
 * vector when the adjudicator hasn't named one, and the code has always called
 * that "nearest-centroid". It wasn't: `generate-embeddings.ts categories`
 * embedded `row.name`, so the comparison was an ingredient NAME against a
 * shelf LABEL — "Cloves" against the word "Mushrooms". Label-to-label
 * similarity is nearly noise, and the winners are decided by which label
 * happens to be a short plural food noun, so "Mushrooms" became the catalogue's
 * junk drawer: Cloves, Saffron, Mint, Bay Leaf, Mussels, Squid Guts and Pumpkin
 * are all filed under it in the live database.
 *
 * Measured against the 359 ingredients whose category the LLM adjudicator chose
 * (the era after 2026-07-29, when its category ids finally matched the DB), the
 * top-1 agreement of the fallback is:
 *
 *   - name embedding (what shipped):           65.2%   Cloves -> Mushrooms 0.377
 *   - name + seed description:                 61.0%   (also drags Chicken Breast into Eggs)
 *   - name + description + exemplar list:      82.5%
 *   - CENTROID of the curated members:         85.5%   Cloves -> Herbs & Spices 0.627
 *
 * The centroid also moves the similarities into a range that MEANS something: a
 * real member scores 0.5-0.7 where every text variant sits at 0.2-0.4 for right
 * and wrong answers alike. That is what makes `CATEGORY_MATCH_FLOOR` in
 * `match-ingredients.ts` possible — see the note there. The two together answer
 * 87.5% right on that set, decline 3.9% of it, and file nothing at all under
 * Mushrooms that is not a mushroom.
 *
 * ## The members come from the SEED FILE, never from the catalogue
 *
 * Averaging whatever currently carries a `category_id` would bake the defect
 * in: today's Mushrooms membership contains Cloves and Mussels, so its centroid
 * would drift toward exactly the things it has been wrongly attracting, and
 * every re-run would make it a better magnet for them. `ingredient-seed.json`
 * is 466 hand-assigned rows and is the only categorisation in this repo nobody
 * guessed.
 *
 * ## Same space as the ingredient vectors, or none of this compares
 *
 * Members are embedded as the bare name with the same model and dimensions
 * `seed-ingredients` and `matchIngredients` use. A centroid built from richer
 * text would live somewhere else in the space and the similarity numbers — and
 * so the floor — would quietly stop meaning what they were measured to mean.
 *
 * ## Usage
 *
 *   npx nx run @fridgeezy/database:embed-categories [-- --dry-run]
 *
 * Re-run it after editing the seed's categories, and on every fresh local
 * stack: the seeds insert categories with no vector at all, and ingredient
 * matching dies with "No categories found" until something fills them.
 */

const SEED_FILE =
    process.env.SEED_FILE ?? "operations/data/ingredient-seed.json";
const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = "text-embedding-3-small" as const;

/** Same dimensions as every other vector here; pgvector cannot index above 2000. */
const DIMENSIONS = 1536;

/** OpenAI caps a request at 2048 inputs; the seed is 466, so one chunk covers it. */
const CHUNK = 256;

/**
 * EVERY shelf gets a centroid, however few members it has, and a shelf with
 * none at all has its vector CLEARED rather than left alone.
 *
 * A minimum was tried (five) and it is the wrong instinct: it left Eggs — three
 * curated members, and about as tight a cluster as this catalogue has — holding
 * its old name embedding, which is the real hazard. Centroid similarities live
 * at 0.5-0.7 and name-label similarities at 0.2-0.4, so ONE stale vector in the
 * table is not a slightly worse shelf, it is a shelf that can never win — while
 * `CATEGORY_MATCH_FLOOR` on the other side is calibrated for one regime.
 *
 * Clearing is the same argument: `search_categories` skips a null embedding, so
 * an unseeded shelf simply stops being offered, where a stale one would keep
 * competing on numbers that no longer mean anything.
 */

interface SeedIngredient {
    name: string;
    category: string;
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}

/**
 * Mean of unit vectors, renormalised.
 *
 * Each member is normalised BEFORE averaging so a long name with a larger
 * magnitude does not weigh more than a short one, and the mean is normalised
 * again so the stored vector is comparable under cosine distance the way every
 * other vector in this database is.
 */
function centroid(vectors: number[][]): number[] {
    const dims = vectors[0].length;
    const sum = new Array<number>(dims).fill(0);

    for (const vector of vectors) {
        const length = Math.hypot(...vector) || 1;
        for (let i = 0; i < dims; i++) sum[i] += vector[i] / length;
    }

    const mean = sum.map((value) => value / vectors.length);
    const length = Math.hypot(...mean) || 1;
    return mean.map((value) => value / length);
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

async function main() {
    const seeds: SeedIngredient[] = JSON.parse(
        readFileSync(join(process.cwd(), SEED_FILE), "utf8")
    );

    const { data: categories, error: categoriesError } = await supabaseAdmin
        .from("categories")
        .select("id, name, canonical_id");
    if (categoriesError) throw new Error(categoriesError.message);

    const membersByCanonical = new Map<string, string[]>();
    for (const seed of seeds) {
        const names = membersByCanonical.get(seed.category);
        if (names) names.push(seed.name);
        else membersByCanonical.set(seed.category, [seed.name]);
    }

    // A seed category the database has never heard of is a typo in the seed,
    // and it would silently contribute to nothing.
    const unknown = [...membersByCanonical.keys()].filter(
        (canonical) =>
            !(categories ?? []).some((c) => c.canonical_id === canonical)
    );
    if (unknown.length > 0) {
        console.error(
            `Unknown category canonical_ids in ${SEED_FILE}: ${unknown.join(", ")}`
        );
        process.exit(1);
    }

    const names = [...new Set(seeds.map((seed) => seed.name))];
    const vectorByName = new Map<string, number[]>();

    for (const batch of chunk(names, CHUNK)) {
        const { embeddings } = await generateBatchEmbeddings(batch, {
            model: MODEL,
            dimensions: DIMENSIONS,
        });
        batch.forEach((name, index) =>
            vectorByName.set(name, embeddings[index])
        );
    }

    console.log(`Embedded ${names.length} seed ingredient name(s)\n`);

    const centroids: {
        id: string;
        name: string;
        members: number;
        vector: number[];
    }[] = [];
    const unseeded: { id: string; name: string }[] = [];

    for (const category of categories ?? []) {
        const members =
            membersByCanonical.get(category.canonical_id as string) ?? [];
        const vectors = members
            .map((name) => vectorByName.get(name))
            .filter((vector): vector is number[] => !!vector);

        if (vectors.length === 0) {
            unseeded.push({
                id: category.id as string,
                name: category.name as string,
            });
            continue;
        }

        centroids.push({
            id: category.id as string,
            name: category.name as string,
            members: vectors.length,
            vector: centroid(vectors),
        });
    }

    // Two shelves that sit on top of each other cannot be told apart by the
    // thing that reads them, so the separation is reported rather than assumed.
    console.log("Category centroids (nearest neighbouring shelf):");
    for (const entry of centroids) {
        const nearest = centroids
            .filter((other) => other.id !== entry.id)
            .map((other) => ({
                name: other.name,
                s: cosine(entry.vector, other.vector),
            }))
            .sort((a, b) => b.s - a.s)[0];
        console.log(
            `  ${entry.name.padEnd(16)} ${String(entry.members).padStart(3)} member(s)` +
                `   nearest: ${nearest.name} ${nearest.s.toFixed(3)}`
        );
    }

    if (unseeded.length > 0) {
        console.warn(
            `\nNo seed members — clearing the vector, so nothing is filed here ` +
                `until ${SEED_FILE} gains one:\n  ` +
                unseeded.map((category) => category.name).join("\n  ")
        );
    }

    if (DRY_RUN) {
        console.log("\nDry run — nothing written.");
        return;
    }

    let written = 0;

    for (const category of unseeded) {
        const { error } = await supabaseAdmin
            .from("categories")
            .update({ embedding: null })
            .eq("id", category.id);
        if (error) console.error(`  failed ${category.name}: ${error.message}`);
    }

    for (const entry of centroids) {
        const { error } = await supabaseAdmin
            .from("categories")
            .update({ embedding: JSON.stringify(entry.vector) })
            .eq("id", entry.id);

        if (error) {
            console.error(`  failed ${entry.name}: ${error.message}`);
            continue;
        }
        written++;
    }

    console.log(`\nDone — ${written}/${centroids.length} centroid(s) written.`);
}

main();
