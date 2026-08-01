import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CookingAction = Tables<"cooking_actions">;

export type CookingActionInsertPayload = TablesInsert<"cooking_actions">;

export type CookingActionUpdatePayload = TablesUpdate<"cooking_actions">;
