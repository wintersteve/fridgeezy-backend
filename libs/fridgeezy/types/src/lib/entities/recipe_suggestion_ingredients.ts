import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeSuggestionIngredients = Tables<"recipe_suggestion_ingredients">;

export type RecipeSuggestionIngredientsInsertPayload = TablesInsert<"recipe_suggestion_ingredients">;

export type RecipeSuggestionIngredientsUpdatePayload = TablesUpdate<"recipe_suggestion_ingredients">;
