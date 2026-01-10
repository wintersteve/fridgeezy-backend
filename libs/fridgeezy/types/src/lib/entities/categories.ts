import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Category = Tables<"categories">;

export type CategoryInsertPayload = TablesInsert<"categories">;

export type CategoryUpdatePayload = TablesUpdate<"categories">;
