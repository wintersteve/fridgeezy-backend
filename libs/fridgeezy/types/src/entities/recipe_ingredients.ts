import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type RecipeIngredients = Tables<"recipe_ingredients">;

export type RecipeIngredientsInsertPayload = TablesInsert<"recipe_ingredients">;

export type RecipeIngredientsUpdatePayload = TablesUpdate<"recipe_ingredients">;
