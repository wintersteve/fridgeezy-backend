import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestionComponent = Tables<"recipe_suggestion_components">;

export type RecipeSuggestionComponentInsertPayload = TablesInsert<"recipe_suggestion_components">;

export type RecipeSuggestionComponentUpdatePayload = TablesUpdate<"recipe_suggestion_components">;
