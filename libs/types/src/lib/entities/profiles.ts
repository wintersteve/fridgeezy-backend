import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Profile = Tables<"profiles">;

export type ProfileInsertPayload = TablesInsert<"profiles">;

export type ProfileUpdatePayload = TablesUpdate<"profiles">;
