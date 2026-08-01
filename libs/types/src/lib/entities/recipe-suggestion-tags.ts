import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestionTag = Tables<"recipe_suggestion_tags">;

export type RecipeSuggestionTagInsertPayload = TablesInsert<"recipe_suggestion_tags">;

export type RecipeSuggestionTagUpdatePayload = TablesUpdate<"recipe_suggestion_tags">;
