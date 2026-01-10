import { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type ProfileRecipeInteractions = Tables<"profile_recipe_interactions">;

export type ProfileRecipeInteractionsInsertPayload = TablesInsert<"profile_recipe_interactions">;

export type ProfileRecipeInteractionsUpdatePayload = TablesUpdate<"profile_recipe_interactions">;
