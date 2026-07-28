import "dotenv/config";
import { generateBatchEmbeddings } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";

export async function generateIngredientsEmbeddings() {
    console.log("Starting ingredients embedding generation...\n");

    try {
        // 1. Fetch all canonical dietary tags that don't have embeddings
        console.log("Fetching canonical dietary tags from database...");

        const { data: ingredients, error: fetchError } = await supabaseAdmin
            .from("ingredients")
            .select("id, name")
            .is("embedding", null)
            .order("name");

        if (fetchError) {
            throw new Error(
                `Failed to fetch ingredients: ${fetchError.message}`
            );
        }

        if (!ingredients || ingredients.length === 0) {
            console.log(
                "No canonical ingredients found without embeddings. Nothing to do!"
            );
            return;
        }

        console.log(`Found ${ingredients.length} ingredients to process:\n`);

        ingredients.forEach((tag, index) => {
            console.log(`  ${index + 1}. ${tag.name}`);
        });

        console.log("");

        // 2. Generate embeddings in batch (all 18 tags fit in one API call)
        console.log("Generating embeddings via OpenAI API...");

        const result = await generateBatchEmbeddings(
            ingredients.map((tag) => tag.name),
            {
                model: "text-embedding-3-small",
                dimensions: 1536,
            }
        );

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        // 3. Update tags in database
        console.log("Storing embeddings in database...");
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < ingredients.length; i++) {
            const ingredient = ingredients[i];
            const embedding = result.embeddings[i];

            const { error: updateError } = await supabaseAdmin
                .from("ingredients")
                .update({ embedding: JSON.stringify(embedding) })
                .eq("id", ingredient.id);

            if (updateError) {
                console.error(
                    `  ✗ Failed to update ${ingredient.name}: ${updateError.message}`
                );
                errorCount++;
            } else {
                console.log(`  ✓ Updated ${ingredient.name}`);
                successCount++;
            }
        }

        // 4. Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total tags processed: ${ingredients.length}`);
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

generateIngredientsEmbeddings();
