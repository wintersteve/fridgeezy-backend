import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Tag = Tables<"tags">;

export type TagInsertPayload = TablesInsert<"tags">;

export type TagUpdatePayload = TablesUpdate<"tags">;
