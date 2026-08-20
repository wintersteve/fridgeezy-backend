import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfilePrompt = Tables<"profile_prompts">;

export type ProfilePromptInsertPayload = TablesInsert<"profile_prompts">;

export type ProfilePromptUpdatePayload = TablesUpdate<"profile_prompts">;
