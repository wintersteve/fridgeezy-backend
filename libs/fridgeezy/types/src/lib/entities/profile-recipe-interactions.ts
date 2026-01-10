import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type ProfileRecipeInteraction = Tables<"profile_recipe_interactions">;

export type ProfileRecipeInteractionInsertPayload = TablesInsert<"profile_recipe_interactions">;

export type ProfileRecipeInteractionUpdatePayload = TablesUpdate<"profile_recipe_interactions">;
