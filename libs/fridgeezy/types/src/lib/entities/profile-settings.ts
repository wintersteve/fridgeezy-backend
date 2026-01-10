import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileSetting = Tables<"profile_settings">;

export type ProfileSettingInsertPayload = TablesInsert<"profile_settings">;

export type ProfileSettingUpdatePayload = TablesUpdate<"profile_settings">;
