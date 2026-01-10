import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeInstructions = Tables<"recipe_instructions">;

export type RecipeInstructionsInsertPayload = TablesInsert<"recipe_instructions">;

export type RecipeInstructionsUpdatePayload = TablesUpdate<"recipe_instructions">;
