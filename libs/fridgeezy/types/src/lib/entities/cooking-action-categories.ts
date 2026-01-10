import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CookingActionCategory = Tables<"cooking_action_categories">;

export type CookingActionCategoryInsertPayload = TablesInsert<"cooking_action_categories">;

export type CookingActionCategoryUpdatePayload = TablesUpdate<"cooking_action_categories">;
