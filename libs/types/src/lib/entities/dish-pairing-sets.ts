import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type DishPairingSet = Tables<"dish_pairing_sets">;

export type DishPairingSetInsertPayload = TablesInsert<"dish_pairing_sets">;

export type DishPairingSetUpdatePayload = TablesUpdate<"dish_pairing_sets">;
