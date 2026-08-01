import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Collection = Tables<"collections">;

export type CollectionInsertPayload = TablesInsert<"collections">;

export type CollectionUpdatePayload = TablesUpdate<"collections">;
