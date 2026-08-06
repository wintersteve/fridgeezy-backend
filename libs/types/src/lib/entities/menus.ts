import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Menu = Tables<"menus">;

export type MenuInsertPayload = TablesInsert<"menus">;

export type MenuUpdatePayload = TablesUpdate<"menus">;
