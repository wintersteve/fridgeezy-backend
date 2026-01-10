import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Categories = Tables<"categories">;

export type CategoriesInsertPayload = TablesInsert<"categories">;

export type CategoriesUpdatePayload = TablesUpdate<"categories">;
