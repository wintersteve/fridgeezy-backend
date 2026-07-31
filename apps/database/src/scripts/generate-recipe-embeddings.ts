import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { buildSuggestionSignature } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * (Re)build recipes.fts from each recipe's dish SIGNATURE — the same text
 * suggestions are embedded with (English name + tags + ingredients), built by the
 * shared `buildSuggestionSignature` so a stored recipe vector and a suggestion's
 * query vector for the same dish are directly comparable.
 *
 * This replaces the original name-only embedding. A bare name can't recognise its
 * own dish from a paraphrase ("apple strudel" scored 0.746 against a recipe named
 * `Apfelstrudel`, under the 0.75 search threshold), which let dishes the user
 * already owns be re-suggested and re-generated.
 *
 * Re-embeds EVERY recipe by default, because the embedding TEXT changed rather
 * than merely being absent — a row still holding a name-only vector is not
 * comparable with a freshly written signature one. Pass `--missing-only` to embed
 * just the rows that have no vector at all.
 */
export async function generateRecipeEmbeddings() {
    const missingOnly = process.argv.includes("--missing-only");

    console.log(
        `Starting recipes.fts signature backfill${missingOnly ? " (missing only)" : " (all recipes)"}...\n`
    );

    try {
        console.log("Fetching recipes from database...");

        let query = supabaseAdmin
            .from("recipes")
            .select(
                `
                id,
                name,
                name_en,
                recipe_ingredients (
                    ingredient:ingredients ( name )
                ),
                recipe_tags (
                    tag:tags ( name )
                )
            `
            )
            .order("name");

        if (missingOnly) {
            query = query.is("fts", null);
        }

        const { data: recipes, error: fetchError } = await query;

        if (fetchError) {
            throw new Error(`Failed to fetch recipes: ${fetchError.message}`);
        }

        if (!recipes || recipes.length === 0) {
            console.log("No recipes to embed. Nothing to do!");
            return;
        }

        console.log(`Found ${recipes.length} recipes to process.\n`);

        // 2. Generate embeddings in batch (small model, 1536 dims)
        console.log("Generating embeddings via OpenAI API...");

        const signatures = recipes.map((recipe) =>
            buildSuggestionSignature({
                name: recipe.name,
                nameEn: recipe.name_en,
                tags: recipe.recipe_tags.map((rt) => rt.tag.name),
                ingredients: recipe.recipe_ingredients.map(
                    (ri) => ri.ingredient.name
                ),
            })
        );

        const result = await generateBatchEmbeddings(signatures, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        // 3. Store embeddings
        console.log("Storing embeddings in database...");
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < recipes.length; i++) {
            const recipe = recipes[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabaseAdmin
                .from("recipes")
                .update({ fts: JSON.stringify(embedding) })
                .eq("id", recipe.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${recipe.name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                successCount++;
            }
        }

        // 4. Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total recipes processed: ${recipes.length}`);
        console.log(`Successful updates: ${successCount}`);
        console.log(`Failed updates: ${errorCount}`);
        console.log(`API tokens used: ${result.usage.total_tokens}`);

        // Estimate cost (text-embedding-3-small: $0.02 per 1M tokens)
        const estimatedCost = (result.usage.total_tokens / 1_000_000) * 0.02;
        console.log(`Estimated cost: $${estimatedCost.toFixed(6)}`);

        if (errorCount > 0) {
            process.exit(1);
        }
    } catch (error) {
        console.error(
            "\nFATAL ERROR:",
            error instanceof Error ? error.message : error
        );
        process.exit(1);
    }
}

generateRecipeEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
