import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type TagAlias = Tables<"tag_aliases">;

export type TagAliasInsertPayload = TablesInsert<"tag_aliases">;

export type TagAliasUpdatePayload = TablesUpdate<"tag_aliases">;
