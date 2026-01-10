import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CollectionRecipes = Tables<"collection_recipes">;

export type CollectionRecipesInsertPayload = TablesInsert<"collection_recipes">;

export type CollectionRecipesUpdatePayload = TablesUpdate<"collection_recipes">;
