import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeFamilyDefault = Tables<"recipe_family_defaults">;

export type RecipeFamilyDefaultInsertPayload = TablesInsert<"recipe_family_defaults">;

export type RecipeFamilyDefaultUpdatePayload = TablesUpdate<"recipe_family_defaults">;
