import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ShoppingLists = Tables<"shopping_lists">;

export type ShoppingListsInsertPayload = TablesInsert<"shopping_lists">;

export type ShoppingListsUpdatePayload = TablesUpdate<"shopping_lists">;
