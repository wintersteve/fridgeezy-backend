import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabase } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Generate and store embeddings for all tags
 * Processes tags of all types (dietary, cuisine, component, course)
 */
export async function generateTagEmbeddings() {
    console.log("Starting tag embedding generation...\n");

    try {
        // 1. Fetch all tags that don't have embeddings
        console.log("Fetching tags from database...");

        const { data: tags, error: fetchError } = await supabase
            .from("tags")
            .select("id, name, canonical_id, type")
            .is("embedding", null)
            .order("type")
            .order("name");

        if (fetchError) {
            throw new Error(`Failed to fetch tags: ${fetchError.message}`);
        }

        if (!tags || tags.length === 0) {
            console.log("No tags found without embeddings. Nothing to do!");
            return;
        }

        console.log(`Found ${tags.length} tags to process:\n`);

        // Group by type for display
        const byType = tags.reduce(
            (acc, tag) => {
                acc[tag.type] = acc[tag.type] || [];
                acc[tag.type].push(tag.name);
                return acc;
            },
            {} as Record<string, string[]>
        );

        for (const [type, names] of Object.entries(byType)) {
            console.log(`  ${type}: ${names.length} tags`);
        }

        console.log("");

        // 2. Generate embeddings in batch (all 18 tags fit in one API call)
        console.log("Generating embeddings via OpenAI API...");

        const tagNames = tags.map((tag) => tag.name);

        const result = await generateBatchEmbeddings(tagNames, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        // 3. Update tags in database
        console.log("Storing embeddings in database...");
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabase
                .from("tags")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", tag.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${tag.name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                console.log(`  ✓ Updated ${tag.name}`);
                successCount++;
            }
        }

        // 4. Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total tags processed: ${tags.length}`);
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

generateTagEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
