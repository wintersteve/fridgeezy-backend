import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type PantryItems = Tables<"pantry_items">;

export type PantryItemsInsertPayload = TablesInsert<"pantry_items">;

export type PantryItemsUpdatePayload = TablesUpdate<"pantry_items">;
