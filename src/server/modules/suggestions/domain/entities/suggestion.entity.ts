import { z } from "zod/v4";

export const SuggestionSchema = z.object({
    name: z.string(),
    description: z.string().max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    ingredients: z.array(z.string()),
    tags: z.array(z.string()),
});

export type ISuggestion = z.infer<typeof SuggestionSchema>;

export class Suggestion {
    static create(data: ISuggestion) {
        return SuggestionSchema.parse(data);
    }
}
