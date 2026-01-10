import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type PromptVariable = Tables<"prompt_variables">;

export type PromptVariableInsertPayload = TablesInsert<"prompt_variables">;

export type PromptVariableUpdatePayload = TablesUpdate<"prompt_variables">;
