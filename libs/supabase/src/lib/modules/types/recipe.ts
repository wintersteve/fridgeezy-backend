import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type Recipe = Tables<"recipes">;

export type RecipeInsertPayload = TablesInsert<"recipes">;

export type RecipeUpsertPayload = TablesUpdate<"recipes">;

export type RecipeSuggestion = Tables<"recipe_suggestions">;

export type RecipeSuggestionInsertPayload = TablesInsert<"recipe_suggestions">;

export type RecipeSuggestionUpsertPayload = TablesUpdate<"recipe_suggestions">;
