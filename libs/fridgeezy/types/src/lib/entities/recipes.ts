import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Recipes = Tables<"recipes">;

export type RecipesInsertPayload = TablesInsert<"recipes">;

export type RecipesUpdatePayload = TablesUpdate<"recipes">;
