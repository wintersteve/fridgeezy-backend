import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CookingActionCategories = Tables<"cooking_action_categories">;

export type CookingActionCategoriesInsertPayload = TablesInsert<"cooking_action_categories">;

export type CookingActionCategoriesUpdatePayload = TablesUpdate<"cooking_action_categories">;
