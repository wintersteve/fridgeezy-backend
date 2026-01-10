import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type TagAliases = Tables<"tag_aliases">;

export type TagAliasesInsertPayload = TablesInsert<"tag_aliases">;

export type TagAliasesUpdatePayload = TablesUpdate<"tag_aliases">;
