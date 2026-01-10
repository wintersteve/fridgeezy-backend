import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type RecipeSuggestionTags = Tables<"recipe_suggestion_tags">;

export type RecipeSuggestionTagsInsertPayload = TablesInsert<"recipe_suggestion_tags">;

export type RecipeSuggestionTagsUpdatePayload = TablesUpdate<"recipe_suggestion_tags">;
