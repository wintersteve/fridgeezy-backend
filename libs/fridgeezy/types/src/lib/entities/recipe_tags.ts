import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type RecipeTags = Tables<"recipe_tags">;

export type RecipeTagsInsertPayload = TablesInsert<"recipe_tags">;

export type RecipeTagsUpdatePayload = TablesUpdate<"recipe_tags">;
