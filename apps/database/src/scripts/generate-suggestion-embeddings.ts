import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Backfill embeddings for recipe_suggestions after the 3072 -> 1536 migration.
 * Uses the suggestion name as the embedding text (text-embedding-3-small, 1536),
 * matching what the application now stores on insert via persist_suggestion.
 */
export async function generateSuggestionEmbeddings() {
    console.log("Starting recipe_suggestions embedding backfill...\n");

    try {
        // 1. Fetch suggestions missing an embedding (all of them, post-migration)
        console.log("Fetching suggestions from database...");

        const { data: suggestions, error: fetchError } = await supabaseAdmin
            .from("recipe_suggestions")
            .select("id, name")
            .is("embedding", null)
            .order("name");

        if (fetchError) {
            throw new Error(
                `Failed to fetch suggestions: ${fetchError.message}`
            );
        }

        if (!suggestions || suggestions.length === 0) {
            console.log(
                "No suggestions found without embeddings. Nothing to do!"
            );
            return;
        }

        console.log(`Found ${suggestions.length} suggestions to process.\n`);

        // 2. Generate embeddings in batch (small model, 1536 dims)
        console.log("Generating embeddings via OpenAI API...");

        const names = suggestions.map((s) => s.name);

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

        for (let i = 0; i < suggestions.length; i++) {
            const suggestion = suggestions[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabaseAdmin
                .from("recipe_suggestions")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", suggestion.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${suggestion.name}: ${updateError.message}`
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
        console.log(`Total suggestions processed: ${suggestions.length}`);
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

generateSuggestionEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
