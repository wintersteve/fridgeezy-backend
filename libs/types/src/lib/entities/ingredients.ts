import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Ingredient = Tables<"ingredients">;

export type IngredientInsertPayload = TablesInsert<"ingredients">;

export type IngredientUpdatePayload = TablesUpdate<"ingredients">;
