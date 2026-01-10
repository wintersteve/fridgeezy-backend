import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type Collections = Tables<"collections">;

export type CollectionsInsertPayload = TablesInsert<"collections">;

export type CollectionsUpdatePayload = TablesUpdate<"collections">;
