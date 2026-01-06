export interface EmbeddingOptions {
    model?: "text-embedding-3-small" | "text-embedding-3-large";
    dimensions?: number;
}

export interface BatchEmbeddingResult {
    embeddings: number[][];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}
