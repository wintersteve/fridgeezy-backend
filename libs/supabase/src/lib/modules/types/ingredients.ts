import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type Ingredients = Tables<"ingredients">;

export type IngredientsInsertPayload = TablesInsert<"ingredients">;

export type IngredientsUpdatePayload = TablesUpdate<"ingredients">;
