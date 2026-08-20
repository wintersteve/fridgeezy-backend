import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type SavedMenu = Tables<"saved_menus">;

export type SavedMenuInsertPayload = TablesInsert<"saved_menus">;

export type SavedMenuUpdatePayload = TablesUpdate<"saved_menus">;
