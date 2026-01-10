import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type IngredientSubstitutes = Tables<"ingredient_substitutes">;

export type IngredientSubstitutesInsertPayload = TablesInsert<"ingredient_substitutes">;

export type IngredientSubstitutesUpdatePayload = TablesUpdate<"ingredient_substitutes">;
