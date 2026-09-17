import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type DishPairing = Tables<"dish_pairings">;

export type DishPairingInsertPayload = TablesInsert<"dish_pairings">;

export type DishPairingUpdatePayload = TablesUpdate<"dish_pairings">;
