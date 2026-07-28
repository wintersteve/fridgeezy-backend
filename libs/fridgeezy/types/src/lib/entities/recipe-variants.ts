import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeVariant = Tables<"recipe_variants">;

export type RecipeVariantInsertPayload = TablesInsert<"recipe_variants">;

export type RecipeVariantUpdatePayload = TablesUpdate<"recipe_variants">;
