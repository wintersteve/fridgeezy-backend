import { generateBatchEmbeddings } from "@/src/shared/openai";

/**
 * Generic embedding processor
 */
export interface EmbeddingProcessorOptions<T> {
    items: T[];
    columnExtractor: (item: T) => string; // extract text to embed
    onComplete: (item: T, embedding: number[]) => Promise<void>; // persistence logic
}

export async function processEmbeddings<T>(
    options: EmbeddingProcessorOptions<T>
) {
    const { items, columnExtractor, onComplete } = options;

    if (!items || items.length === 0) {
        console.log("No items provided for embedding. Exiting.");
        return;
    }

    console.log(`Processing ${items.length} items for embedding...\n`);

    try {
        const texts = items.map(columnExtractor);

        console.log("Generating embeddings via OpenAI API...");
        const result = await generateBatchEmbeddings(texts, {
            model: "text-embedding-3-small",
            dimensions: 1536,
        });

        console.log(
            `Successfully generated ${result.embeddings.length} embeddings`
        );
        console.log(`Model: ${result.model}`);
        console.log(`Tokens used: ${result.usage.total_tokens}\n`);

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < items.length; i++) {
            try {
                await onComplete(items[i], result.embeddings[i]);
                console.log(
                    `  ✓ Updated embedding for: ${columnExtractor(items[i])}`
                );
                successCount++;
            } catch (err) {
                console.error(
                    `  ✗ Failed to update ${columnExtractor(items[i])}:`,
                    err instanceof Error ? err.message : err
                );
                errorCount++;
            }
        }

        // Summary
        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total items processed: ${items.length}`);
        console.log(`Successful updates: ${successCount}`);
        console.log(`Failed updates: ${errorCount}`);
        console.log(`API tokens used: ${result.usage.total_tokens}`);

        const estimatedCost = (result.usage.total_tokens / 1_000_000) * 0.02;

        console.log(`Estimated cost: $${estimatedCost.toFixed(6)}`);

        if (errorCount > 0) process.exit(1);
    } catch (error) {
        console.error(
            "\nFATAL ERROR:",
            error instanceof Error ? error.message : error
        );
        process.exit(1);
    }
}
