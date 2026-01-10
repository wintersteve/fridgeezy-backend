import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type Tags = Tables<"tags">;

export type TagsInsertPayload = TablesInsert<"tags">;

export type TagsUpdatePayload = TablesUpdate<"tags">;
