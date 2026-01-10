import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestionIngredient = Tables<"recipe_suggestion_ingredients">;

export type RecipeSuggestionIngredientInsertPayload = TablesInsert<"recipe_suggestion_ingredients">;

export type RecipeSuggestionIngredientUpdatePayload = TablesUpdate<"recipe_suggestion_ingredients">;
