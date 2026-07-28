import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type CollectionRecipe = Tables<"collection_recipes">;

export type CollectionRecipeInsertPayload = TablesInsert<"collection_recipes">;

export type CollectionRecipeUpdatePayload = TablesUpdate<"collection_recipes">;
