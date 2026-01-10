import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Prompts = Tables<"prompts">;

export type PromptsInsertPayload = TablesInsert<"prompts">;

export type PromptsUpdatePayload = TablesUpdate<"prompts">;
