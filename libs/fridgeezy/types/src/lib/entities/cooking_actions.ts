import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CookingActions = Tables<"cooking_actions">;

export type CookingActionsInsertPayload = TablesInsert<"cooking_actions">;

export type CookingActionsUpdatePayload = TablesUpdate<"cooking_actions">;
