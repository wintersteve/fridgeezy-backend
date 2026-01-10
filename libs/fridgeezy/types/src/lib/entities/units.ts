import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Units = Tables<"units">;

export type UnitsInsertPayload = TablesInsert<"units">;

export type UnitsUpdatePayload = TablesUpdate<"units">;
