import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileSettings = Tables<"profile_settings">;

export type ProfileSettingsInsertPayload = TablesInsert<"profile_settings">;

export type ProfileSettingsUpdatePayload = TablesUpdate<"profile_settings">;
