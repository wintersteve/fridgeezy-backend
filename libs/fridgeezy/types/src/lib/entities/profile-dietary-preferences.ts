import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileDietaryPreference = Tables<"profile_dietary_preferences">;

export type ProfileDietaryPreferenceInsertPayload = TablesInsert<"profile_dietary_preferences">;

export type ProfileDietaryPreferenceUpdatePayload = TablesUpdate<"profile_dietary_preferences">;
