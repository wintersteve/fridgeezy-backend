import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileCookedLog = Tables<"profile_cooked_log">;

export type ProfileCookedLogInsertPayload = TablesInsert<"profile_cooked_log">;

export type ProfileCookedLogUpdatePayload = TablesUpdate<"profile_cooked_log">;
