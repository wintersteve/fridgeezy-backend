import { Tables, TablesInsert, TablesUpdate } from "../database.types";

export type IngredientMergeReview = Tables<"ingredient_merge_reviews">;

export type IngredientMergeReviewInsertPayload = TablesInsert<"ingredient_merge_reviews">;

export type IngredientMergeReviewUpdatePayload = TablesUpdate<"ingredient_merge_reviews">;
