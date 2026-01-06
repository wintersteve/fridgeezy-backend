import { openai } from "../../../client";
import { EmbeddingOptions, BatchEmbeddingResult } from "../../types";

/**
 * Generate embeddings for multiple text inputs in a single API call
 * More efficient than multiple individual calls
 * @param texts - Array of texts to embed
 * @param options - Model and dimension options
 * @returns Array of embedding vectors and metadata
 */
export async function generateBatchEmbeddings(
    texts: string[],
    options: EmbeddingOptions = {}
): Promise<BatchEmbeddingResult> {
    const { model = "text-embedding-3-small", dimensions } = options;

    if (texts.length === 0) {
        throw new Error("Cannot generate embeddings for empty array");
    }

    // OpenAI has a limit of 2048 inputs per request
    if (texts.length > 2048) {
        throw new Error("Batch size exceeds OpenAI limit of 2048 inputs");
    }

    try {
        const response = await openai.embeddings.create({
            model,
            input: texts,
            ...(dimensions && { dimensions }),
        });

        if (!response.data || response.data.length !== texts.length) {
            throw new Error(
                `Expected ${texts.length} embeddings but received ${response.data?.length || 0}`
            );
        }

        return {
            embeddings: response.data.map((item) => item.embedding),
            model: response.model,
            usage: response.usage,
        };
    } catch (error) {
        console.error("Failed to generate batch embeddings:", error);
        throw new Error(
            `Batch embedding generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}
