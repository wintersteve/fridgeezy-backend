import { openai } from "../../client";

/**
 * Generate an embedding for a single text input
 *
 * Uses OpenAI's text-embedding-3-small model with 1536 dimensions
 * for semantic similarity matching.
 *
 * @param text Text to generate embedding for
 * @returns 1536-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
        throw new Error("Cannot generate embedding for empty text");
    }

    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text,
            dimensions: 1536,
        });

        if (!response.data || response.data.length === 0) {
            throw new Error("No embedding returned from OpenAI");
        }

        return response.data[0].embedding;
    } catch (error) {
        console.error("Failed to generate embedding:", error);
        throw new Error(
            `Embedding generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}
