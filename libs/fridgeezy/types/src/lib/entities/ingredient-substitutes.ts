import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type IngredientSubstitute = Tables<"ingredient_substitutes">;

export type IngredientSubstituteInsertPayload = TablesInsert<"ingredient_substitutes">;

export type IngredientSubstituteUpdatePayload = TablesUpdate<"ingredient_substitutes">;
