import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Generate and store embeddings for all units.
 * Uses unit name and abbreviation as the text for embedding generation.
 */
export async function generateUnitEmbeddings() {
    console.log("Starting unit embedding generation...\n");

    try {
        // 1. Fetch all units that don't have embeddings
        console.log("Fetching units from database...");

        const { data: units, error: fetchError } = await supabaseAdmin
            .from("units")
            .select("id, name, abbreviation, type")
            .is("embedding", null)
            .order("name");

        if (fetchError) {
            throw new Error(`Failed to fetch units: ${fetchError.message}`);
        }

        if (!units || units.length === 0) {
            console.log("No units found without embeddings. Nothing to do!");
            return;
        }

        console.log(`Found ${units.length} units to process:\n`);

        // List all units
        for (const unit of units) {
            console.log(`  - ${unit.name} (${unit.abbreviation})`);
        }

        console.log("");

        // 2. Generate embeddings in batch
        // Use descriptive text for better semantic matching
        console.log("Generating embeddings via OpenAI API...");

        const unitTexts = units.map(
            (unit) =>
                `${unit.name} ${unit.abbreviation} measurement unit for ${unit.type}`
        );

        const result = await generateBatchEmbeddings(unitTexts, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        // 3. Update units in database
        console.log("Storing embeddings in database...");
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabaseAdmin
                .from("units")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", unit.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${unit.name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                console.log(`  ✓ Updated ${unit.name}`);
                successCount++;
            }
        }

        // 4. Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total units processed: ${units.length}`);
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

generateUnitEmbeddings()
    .then(() => {
        console.log("\nScript completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\nScript failed:", error);
        process.exit(1);
    });
