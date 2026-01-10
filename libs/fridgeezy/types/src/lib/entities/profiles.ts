import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Profiles = Tables<"profiles">;

export type ProfilesInsertPayload = TablesInsert<"profiles">;

export type ProfilesUpdatePayload = TablesUpdate<"profiles">;
