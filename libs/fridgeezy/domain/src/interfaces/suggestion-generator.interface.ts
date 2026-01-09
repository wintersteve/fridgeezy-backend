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
