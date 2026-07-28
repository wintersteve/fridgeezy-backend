import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeIngredient = Tables<"recipe_ingredients">;

export type RecipeIngredientInsertPayload = TablesInsert<"recipe_ingredients">;

export type RecipeIngredientUpdatePayload = TablesUpdate<"recipe_ingredients">;
