import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileIngredientSubstitution = Tables<"profile_ingredient_substitutions">;

export type ProfileIngredientSubstitutionInsertPayload = TablesInsert<"profile_ingredient_substitutions">;

export type ProfileIngredientSubstitutionUpdatePayload = TablesUpdate<"profile_ingredient_substitutions">;
