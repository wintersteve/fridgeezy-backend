import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type PromptVariables = Tables<"prompt_variables">;

export type PromptVariablesInsertPayload = TablesInsert<"prompt_variables">;

export type PromptVariablesUpdatePayload = TablesUpdate<"prompt_variables">;
