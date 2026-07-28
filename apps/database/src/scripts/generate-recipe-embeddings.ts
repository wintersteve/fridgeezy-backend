import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Backfill embeddings for recipes.fts after the 3072 -> 1536 migration.
 * Uses the recipe name as the embedding text (text-embedding-3-small, 1536),
 * matching what the application now stores via RecipesRepository.updateEmbedding.
 */
export async function generateRecipeEmbeddings() {
    console.log("Starting recipes.fts embedding backfill...\n");

    try {
        // 1. Fetch recipes missing an embedding (all of them, post-migration)
        console.log("Fetching recipes from database...");

        const { data: recipes, error: fetchError } = await supabaseAdmin
            .from("recipes")
            .select("id, name")
            .is("fts", null)
            .order("name");

        if (fetchError) {
            throw new Error(`Failed to fetch recipes: ${fetchError.message}`);
        }

        if (!recipes || recipes.length === 0) {
            console.log("No recipes found without embeddings. Nothing to do!");
            return;
        }

        console.log(`Found ${recipes.length} recipes to process.\n`);

        // 2. Generate embeddings in batch (small model, 1536 dims)
        console.log("Generating embeddings via OpenAI API...");

        const names = recipes.map((r) => r.name);

        const result = await generateBatchEmbeddings(names, {
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
