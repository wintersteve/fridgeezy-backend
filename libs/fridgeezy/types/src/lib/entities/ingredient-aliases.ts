import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type IngredientAlias = Tables<"ingredient_aliases">;

export type IngredientAliasInsertPayload = TablesInsert<"ingredient_aliases">;

export type IngredientAliasUpdatePayload = TablesUpdate<"ingredient_aliases">;
