import { z } from "zod/v4";

export const GenerateSuggestionRequestSchema = z.object({
    blacklist: z.array(z.string()).optional(),
    component: z.string().optional(),
    course: z.string().optional(),
    cuisine: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    ingredients: z.array(z.string()).optional(),
});

export const GenerateSuggestionResponseSchema = z.object({
    name: z.string(),
    description: z.string().max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(z.string()),
    tags: z.array(z.string()),
});

export type GenerateSuggestionResponseDto = z.infer<
    typeof GenerateSuggestionResponseSchema
>;
