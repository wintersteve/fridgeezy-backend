import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { IngredientsRepository } from "@fridgeezy/supabase";

/**
 * Give newly created ingredients the name embedding the resolver searches on,
 * so a row invented by the SQL persist path stops being permanently invisible.
 *
 * ## Why this exists
 *
 * There are two ingredient pipelines, and only one of them embeds.
 * `matchIngredients` (TypeScript) computes an embedding before it creates and
 * writes it with the row — it will SKIP a name whose embedding failed rather
 * than create an unembedded one, so that path cannot produce this defect.
 * `persist_recipe` (SQL) does `INSERT INTO ingredients (canonical_id, name,
 * category_id) ... ON CONFLICT` inside the same statement that writes the
 * recipe. SQL cannot call OpenAI, so those rows arrive with a null embedding.
 *
 * A null embedding is not a cosmetic gap. `vectorSearch` can never return such
 * a row, so it is unreachable by layer 3 of the resolver — which means the next
 * recipe that names the same thing cannot match it and creates a second row
 * beside it, also unembedded. It is a self-perpetuating fragmentation sink, and
 * it got sharper rather than softer when retrieval widened from one neighbour
 * to ten: the reachable set grew for every embedded row and stayed at zero for
 * these.
 *
 * Measured on the dev catalogue before this landed: 20 such rows, every one on
 * a variant recipe and 20 of 21 on a `hard` rung — `Kosher Salt`,
 * `Kewpie Mayonnaise`, `Whole Black Peppercorns`, `Toasted Sesame Seeds`. That
 * is difficulty escalation reaching for a fancier register, and every
 * embellished name became a permanent new entity.
 *
 * ## What this does NOT do
 *
 * It does not deduplicate. By the time this runs the row exists and the recipe
 * points at it, so a near-duplicate created this request stays a near-duplicate
 * — `ingredient_alias_collisions` and the review queue are what find those. The
 * claim here is narrower and still worth making: the row becomes REACHABLE, so
 * the NEXT occurrence of that name resolves onto it instead of forking again.
 * Closing the hole properly is routing the SQL path through `matchIngredients`
 * (step 3 in INGREDIENT_IDENTITY.md, still not built); this is the cheap half
 * that stops the bleeding without touching how recipes persist.
 *
 * ## One batched call, and only when there is work
 *
 * The unembedded set is re-read from the database rather than taken from the
 * caller, so a recipe whose ingredients all already exist — the overwhelmingly
 * common case — makes NO OpenAI call at all. When there is work it is a single
 * `generateBatchEmbeddings` request covering every missing name in the recipe,
 * not one per ingredient, matching what `matchIngredients` already does.
 *
 * ## It never throws, and never rejects
 *
 * Same contract as its two siblings, for the same reason: the recipe is already
 * written and streaming to the client, and nothing in the request reads this.
 * A failure leaves the row exactly as `persist_recipe` created it — present,
 * usable, and correct in every respect except that it cannot be found by vector
 * search. That is the state this repo has been in all along, so a failure here
 * is never a regression; it just fails to be the improvement.
 *
 * Because that failure is invisible in the data, it is made loud in the log:
 * every path out of here that leaves a row unembedded says so, names the
 * ingredients, and marks itself `[Embeddings]` so it can be grepped and
 * alerted on. `operations/generate-embeddings.ts` remains the bulk repair —
 * it backfills exactly the rows this missed, with no argument needed.
 */
export async function embedNewIngredients(
    ingredientIds: string[]
): Promise<void> {
    if (ingredientIds.length === 0) return;

    const ingredientsRepo = new IngredientsRepository();

    try {
        // Re-read rather than trusting the caller's list. Two reasons: most
        // ingredients on a recipe already have vectors and must not be
        // re-embedded, and re-reading is what makes this idempotent, so a
        // retry — or two concurrent persists of the same dish — costs nothing.
        const unembedded = await ingredientsRepo.findUnembedded(ingredientIds);

        if (unembedded.success === false) {
            console.error(
                "[Embeddings] Failed to read unembedded ingredients — rows stay " +
                    "invisible to vector search until `embed-ingredients` runs:",
                unembedded.error
            );
            return;
        }

        const rows = unembedded.value;

        if (rows.length === 0) return;

        const names = rows.map((row) => row.name);

        let embeddings: number[][];
        try {
            // Same model and dimensions as every other vector in this database.
            // 1536 is not a preference: pgvector cannot index above 2000 dims,
            // so a larger model would silently cost every vector index here.
            const batch = await generateBatchEmbeddings(names, {
                model: "text-embedding-3-small",
                dimensions: 1536,
            });
            embeddings = batch.embeddings;
        } catch (error) {
            // The loud branch. A quota exhaustion, a 429 or a network failure
            // all land here, and the rows stay exactly as the SQL created
            // them — so the names are printed, because the only other record
            // that these specific rows need repair is a query nobody runs.
            console.error(
                `[Embeddings] Failed to embed ${names.length} new ingredient(s) — ` +
                    `they remain invisible to vector search until ` +
                    `\`nx run @fridgeezy/database:embed-ingredients\` runs. ` +
                    `Names: ${names.join(", ")}. Cause:`,
                error instanceof Error ? error.message : error
            );
            return;
        }

        if (embeddings.length !== rows.length) {
            // Defensive: a short batch would otherwise pair names with the
            // wrong vectors, which is worse than not embedding at all —
            // an ingredient findable under somebody else's name.
            console.error(
                `[Embeddings] Batch returned ${embeddings.length} vector(s) for ` +
                    `${rows.length} ingredient(s); refusing to write a possible ` +
                    `mispairing. Names: ${names.join(", ")}`
            );
            return;
        }

        let written = 0;
        const failed: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const embedding = embeddings[i];
            if (!embedding) {
                failed.push(row.name);
                continue;
            }

            const result = await ingredientsRepo.setEmbedding(row.id, embedding);

            if (result.success === false) {
                failed.push(row.name);
                console.error(
                    `[Embeddings] Failed to write embedding for "${row.name}":`,
                    result.error
                );
                continue;
            }
            written++;
        }

        if (failed.length > 0) {
            console.error(
                `[Embeddings] ${failed.length} of ${rows.length} ingredient(s) left ` +
                    `unembedded and unreachable by vector search: ${failed.join(", ")}`
            );
        }

        if (written > 0) {
            console.log(
                `[Embeddings] Embedded ${written} ingredient(s) created by the SQL ` +
                    `persist path: ${rows
                        .filter((row) => !failed.includes(row.name))
                        .map((row) => row.name)
                        .join(", ")}`
            );
        }
    } catch (error) {
        // Belt and braces: this runs unawaited, so an unexpected throw here
        // would surface as an unhandled rejection with no context attached.
        console.error(
            "[Embeddings] Unexpected failure embedding new ingredients — rows stay " +
                "invisible to vector search:",
            error
        );
    }
}
