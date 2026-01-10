import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileBlacklistedIngredient = Tables<"profile_blacklisted_ingredients">;

export type ProfileBlacklistedIngredientInsertPayload = TablesInsert<"profile_blacklisted_ingredients">;

export type ProfileBlacklistedIngredientUpdatePayload = TablesUpdate<"profile_blacklisted_ingredients">;
