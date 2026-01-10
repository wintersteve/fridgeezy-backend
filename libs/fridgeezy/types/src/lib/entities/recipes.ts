import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Recipe = Tables<"recipes">;

export type RecipeInsertPayload = TablesInsert<"recipes">;

export type RecipeUpdatePayload = TablesUpdate<"recipes">;
