import "dotenv/config";

import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { buildSuggestionSignature } from "@fridgeezy/toolkit";

/**
 * Backfills the embedding columns, for one target table per run.
 *
 * Replaces five near-identical scripts. They differed only in three things —
 * which rows to read, what text to embed, and which column to write — so those
 * are the only things a target declares here; the batching, chunking, logging
 * and error handling are shared.
 *
 * Usage:
 *   npx jiti operations/generate-embeddings.ts <target> [--all]
 *
 *   <target>  categories | units | tags | suggestions | recipes
 *   --all     re-embed every row, not just those missing one. Use after
 *             changing a text builder, since existing vectors are then stale
 *             rather than absent.
 *
 * Vectors are generated application-side and written as JSON strings, which is
 * what pgvector accepts over PostgREST. The database has no embedding function
 * of its own — see the note in 20260801000011_search_functions.sql.
 */

/** OpenAI caps a request at 2048 inputs; stay well under and keep payloads small. */
const CHUNK = 200;

const MODEL = "text-embedding-3-small";

interface Target {
    /** Table to read and write. */
    table: string;
    /** Columns (and joins) needed to build the text. */
    select: string;
    /** Column the vector is written to. */
    column: string;
    /** Text that gets embedded. */
    buildText: (row: any) => string;
}

const TARGETS: Record<string, Target> = {
    categories: {
        table: "categories",
        select: "id, name, canonical_id, description",
        column: "embedding",
        buildText: (row) => row.name,
    },
    units: {
        table: "units",
        select: "id, name, abbreviation, type",
        column: "embedding",
        // Descriptive rather than bare: "g" alone carries almost no signal, so
        // the unit is spelled out with what it measures.
        buildText: (row) =>
            `${row.name} ${row.abbreviation} measurement unit for ${row.type}`,
    },
    tags: {
        table: "tags",
        select: "id, name, canonical_id, type",
        column: "embedding",
        buildText: (row) => row.name,
    },
    // Bare name, matching what seed-ingredients embeds on insert and what
    // match-ingredients searches with — the vectors have to live in the same
    // space or the similarity threshold means nothing.
    //
    // Only seed-ingredients embedded these before, and only for rows it created,
    // so anything the LLM added stayed unembedded and invisible to vector
    // matching. That is what this target is for.
    ingredients: {
        table: "ingredients",
        select: "id, name",
        column: "embedding",
        buildText: (row) => row.name,
    },
    // Suggestions and recipes share one text: the dish SIGNATURE, built by the
    // same helper the API uses. That is what makes a stored recipe vector and a
    // freshly generated suggestion vector directly comparable — dedupe depends
    // on it, so these must never drift from buildSuggestionSignature.
    suggestions: {
        table: "recipe_suggestions",
        select: `
            id, name,
            recipe_suggestion_tags ( tags ( name ) ),
            recipe_suggestion_ingredients ( ingredients ( name ) )
        `,
        column: "embedding",
        buildText: (row) =>
            buildSuggestionSignature({
                name: row.name,
                tags: (row.recipe_suggestion_tags ?? [])
                    .map((t: any) => t.tags?.name)
                    .filter(Boolean),
                ingredients: (row.recipe_suggestion_ingredients ?? [])
                    .map((i: any) => i.ingredients?.name)
                    .filter(Boolean),
            }),
    },
    recipes: {
        table: "recipes",
        select: `
            id, name,
            recipe_tags ( tag:tags ( name ) ),
            recipe_ingredients ( ingredient:ingredients ( name ) )
        `,
        // Named `fts` for historical reasons — it began as a tsvector and became
        // the signature embedding when search moved to pgvector.
        column: "fts",
        buildText: (row) =>
            buildSuggestionSignature({
                name: row.name,
                tags: (row.recipe_tags ?? [])
                    .map((rt: any) => rt.tag?.name)
                    .filter(Boolean),
                ingredients: (row.recipe_ingredients ?? [])
                    .map((ri: any) => ri.ingredient?.name)
                    .filter(Boolean),
            }),
    },
};

const [targetName, ...flags] = process.argv.slice(2);
const all = flags.includes("--all");

const target = TARGETS[targetName];

if (!target) {
    console.error(
        `Unknown target ${targetName ? `"${targetName}"` : "(none given)"}.\n` +
            `Usage: generate-embeddings.ts <${Object.keys(TARGETS).join(" | ")}> [--all]`
    );
    process.exit(1);
}

let query = supabaseAdmin.from(target.table as never).select(target.select);
if (!all) query = query.is(target.column, null);

const { data: rows, error } = await query;

if (error) throw new Error(`Failed to read ${target.table}: ${error.message}`);

if (!rows?.length) {
    console.log(
        `Nothing to do — every ${target.table} row already has ${target.column}.`
    );
    process.exit(0);
}

console.log(
    `${target.table}: embedding ${rows.length} row(s)${all ? " (--all)" : ""}`
);

let written = 0;

for (let from = 0; from < rows.length; from += CHUNK) {
    const chunk = rows.slice(from, from + CHUNK);
    const { embeddings } = await generateBatchEmbeddings(
        chunk.map((row) => target.buildText(row)),
        { model: MODEL }
    );

    // Written one row at a time: an upsert would need every NOT NULL column,
    // and these tables have required fields this script never reads.
    for (let i = 0; i < chunk.length; i++) {
        const { error: updateError } = await supabaseAdmin
            .from(target.table as never)
            .update({ [target.column]: JSON.stringify(embeddings[i]) } as never)
            .eq("id", (chunk[i] as any).id);

        if (updateError) {
            console.error(
                `  failed ${(chunk[i] as any).name}: ${updateError.message}`
            );
            continue;
        }
        written++;
    }

    console.log(`  ${Math.min(from + CHUNK, rows.length)}/${rows.length}`);
}

console.log(`Done — ${written}/${rows.length} written.`);
