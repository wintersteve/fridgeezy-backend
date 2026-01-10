import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type ProfileBlacklistedIngredients = Tables<"profile_blacklisted_ingredients">;

export type ProfileBlacklistedIngredientsInsertPayload = TablesInsert<"profile_blacklisted_ingredients">;

export type ProfileBlacklistedIngredientsUpdatePayload = TablesUpdate<"profile_blacklisted_ingredients">;
