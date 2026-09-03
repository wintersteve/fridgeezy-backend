import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type PantryStaple = Tables<"pantry_staples">;

export type PantryStapleInsertPayload = TablesInsert<"pantry_staples">;

export type PantryStapleUpdatePayload = TablesUpdate<"pantry_staples">;
