import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestions = Tables<"recipe_suggestions">;

export type RecipeSuggestionsInsertPayload = TablesInsert<"recipe_suggestions">;

export type RecipeSuggestionsUpdatePayload = TablesUpdate<"recipe_suggestions">;
