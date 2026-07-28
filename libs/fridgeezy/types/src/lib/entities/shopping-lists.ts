import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ShoppingList = Tables<"shopping_lists">;

export type ShoppingListInsertPayload = TablesInsert<"shopping_lists">;

export type ShoppingListUpdatePayload = TablesUpdate<"shopping_lists">;
