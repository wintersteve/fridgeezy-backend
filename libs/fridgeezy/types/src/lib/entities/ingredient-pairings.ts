import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type IngredientPairing = Tables<"ingredient_pairings">;

export type IngredientPairingInsertPayload = TablesInsert<"ingredient_pairings">;

export type IngredientPairingUpdatePayload = TablesUpdate<"ingredient_pairings">;
