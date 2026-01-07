import { z } from "zod/v4";

export const IngredientSchema = z.object({
    name: z.string(),
    description: z.string().max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(z.string()),
    tags: z.array(z.string()),
});

export type IIngredient = z.infer<typeof IngredientSchema>;

export class Ingredient {
    static create(data: IIngredient) {
        return IngredientSchema.parse(data);
    }
}
