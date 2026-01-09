/**
 * DTO for suggestion generation request
 */
export interface GenerateSuggestionRequest {
    ingredients: string[];
    blacklist?: string[];
    component?: string;
    course?: string;
    cuisine?: string;
    difficulty?: string;
    dietaryRestrictions?: string[];
}

/**
 * DTO for a single generated suggestion
 */
export interface GeneratedSuggestionDto {
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    ingredients: string[];
    tags: string[];
}

/**
 * Service interface for generating recipe suggestions using AI.
 *
 * Defines the contract for AI-powered recipe suggestion generation.
 * Implementations handle prompt construction, AI service calls, and streaming.
 */
export interface ISuggestionGeneratorService {
    /**
     * Generate recipe suggestions based on provided criteria.
     *
     * Returns a stream of suggestions that can be consumed asynchronously.
     * Each suggestion is validated and typed according to GeneratedSuggestionDto.
     *
     * @param request - Generation criteria (ingredients, filters, etc.)
     * @returns AsyncIterable of generated suggestions
     */
    generateSuggestions(
        request: GenerateSuggestionRequest
    ): AsyncIterable<GeneratedSuggestionDto>;
}
