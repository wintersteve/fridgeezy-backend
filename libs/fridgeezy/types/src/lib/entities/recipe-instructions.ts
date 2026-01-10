import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeInstruction = Tables<"recipe_instructions">;

export type RecipeInstructionInsertPayload = TablesInsert<"recipe_instructions">;

export type RecipeInstructionUpdatePayload = TablesUpdate<"recipe_instructions">;
