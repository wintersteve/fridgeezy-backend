/**
 * Recipe domain entity.
 * Accumulated recipe data structure matching the database schema.
 * Used by recipe generation and escalation use-cases for building recipes progressively.
 */
export interface RecipeAccumulator {
    name: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    servings: number;
    prepTime: number;
    cookTime: number;
    ingredients: Array<{
        name: string;
        category: string;
        parent: string | null;
        quantity: number;
        unit: string;
    }>;
    instructions: Array<{ text: string; ingredients?: string[] }>;
    tips: string[] | null;
    tags: string[];
}
