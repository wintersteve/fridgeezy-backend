import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type NearMissSwappableProperty = Tables<"near_miss_swappable_properties">;

export type NearMissSwappablePropertyInsertPayload = TablesInsert<"near_miss_swappable_properties">;

export type NearMissSwappablePropertyUpdatePayload = TablesUpdate<"near_miss_swappable_properties">;
