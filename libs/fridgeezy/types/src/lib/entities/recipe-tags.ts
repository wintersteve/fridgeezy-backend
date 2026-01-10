import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeTag = Tables<"recipe_tags">;

export type RecipeTagInsertPayload = TablesInsert<"recipe_tags">;

export type RecipeTagUpdatePayload = TablesUpdate<"recipe_tags">;
