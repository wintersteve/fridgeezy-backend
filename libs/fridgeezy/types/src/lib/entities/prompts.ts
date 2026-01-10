import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type Prompt = Tables<"prompts">;

export type PromptInsertPayload = TablesInsert<"prompts">;

export type PromptUpdatePayload = TablesUpdate<"prompts">;
