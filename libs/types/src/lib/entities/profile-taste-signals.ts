import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileTasteSignal = Tables<"profile_taste_signals">;

export type ProfileTasteSignalInsertPayload = TablesInsert<"profile_taste_signals">;

export type ProfileTasteSignalUpdatePayload = TablesUpdate<"profile_taste_signals">;
