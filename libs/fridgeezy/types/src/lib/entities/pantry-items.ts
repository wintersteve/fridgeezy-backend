import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type PantryItem = Tables<"pantry_items">;

export type PantryItemInsertPayload = TablesInsert<"pantry_items">;

export type PantryItemUpdatePayload = TablesUpdate<"pantry_items">;
