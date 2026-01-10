import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type ProfileDietaryPreferences = Tables<"profile_dietary_preferences">;

export type ProfileDietaryPreferencesInsertPayload = TablesInsert<"profile_dietary_preferences">;

export type ProfileDietaryPreferencesUpdatePayload = TablesUpdate<"profile_dietary_preferences">;
