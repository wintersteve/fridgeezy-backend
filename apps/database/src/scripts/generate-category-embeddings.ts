import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabase, supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Generate and store embeddings for all categories
 * Uses category name as the text for embedding generation
 */
export async function generateCategoryEmbeddings() {
    console.log("Starting category embedding generation...\n");

    try {
        // 1. Fetch all categories that don't have embeddings
        console.log("Fetching categories from database...");

        const { data: categories, error: fetchError } = await supabaseAdmin
            .from("categories")
            .select("id, name, canonical_id, description")
            .is("embedding", null)
            .order("name");

        if (fetchError) {
            throw new Error(
                `Failed to fetch categories: ${fetchError.message}`
            );
        }

        if (!categories || categories.length === 0) {
            console.log(
                "No categories found without embeddings. Nothing to do!"
            );
            return;
        }

        console.log(`Found ${categories.length} categories to process:\n`);

        // List all categories
        for (const category of categories) {
            console.log(`  - ${category.name}`);
        }

        console.log("");

        // 2. Generate embeddings in batch
        console.log("Generating embeddings via OpenAI API...");

        const categoryNames = categories.map((category) => category.name);

        const result = await generateBatchEmbeddings(categoryNames, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        // 3. Update categories in database
        console.log("Storing embeddings in database...");
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < categories.length; i++) {
            const category = categories[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabaseAdmin
                .from("categories")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", category.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${category.name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                console.log(`  ✓ Updated ${category.name}`);
                successCount++;
            }
        }

        // 4. Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total categories processed: ${categories.length}`);
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

generateCategoryEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
