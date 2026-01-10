import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type IngredientAliases = Tables<"ingredient_aliases">;

export type IngredientAliasesInsertPayload = TablesInsert<"ingredient_aliases">;

export type IngredientAliasesUpdatePayload = TablesUpdate<"ingredient_aliases">;
