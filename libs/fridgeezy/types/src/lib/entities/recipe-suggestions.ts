import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestion = Tables<"recipe_suggestions">;

export type RecipeSuggestionInsertPayload = TablesInsert<"recipe_suggestions">;

export type RecipeSuggestionUpdatePayload = TablesUpdate<"recipe_suggestions">;
