import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Unit = Tables<"units">;

export type UnitInsertPayload = TablesInsert<"units">;

export type UnitUpdatePayload = TablesUpdate<"units">;
