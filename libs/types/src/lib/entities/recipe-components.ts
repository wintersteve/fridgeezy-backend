import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeComponent = Tables<"recipe_components">;

export type RecipeComponentInsertPayload = TablesInsert<"recipe_components">;

export type RecipeComponentUpdatePayload = TablesUpdate<"recipe_components">;
