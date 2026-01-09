import {
    SuggestionGeneratorService,
    SuggestionsService,
} from "@fridgeezy/application";
import {
    GenerateSuggestionRequestSchema,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";

/**
 * Factory function to create a generateSuggestion handler with dependencies injected.
 *
 * Now properly separated:
 * - Generator service: handles AI generation
 * - Suggestions service: handles persistence
 * - Handler: orchestrates streaming and coordinates services
 */
export const createGenerateSuggestionHandler = (
    generatorService: SuggestionGeneratorService,
    suggestionsService: SuggestionsService
) =>
    createStreamHandler({
        requestSchema: GenerateSuggestionRequestSchema,
        responseSchema: GenerateSuggestionResponseSchema,

        handler: async ({ body }) => {
            // Delegate generation to service
            const suggestionStream = generatorService.generateSuggestions({
                ingredients: body.ingredients || [],
                blacklist: body.blacklist,
                component: body.component,
                course: body.course,
                cuisine: body.cuisine,
                difficulty: body.difficulty,
                dietaryRestrictions: body.dietaryRestrictions,
            });

            return {
                type: "stream" as const,
                stream: suggestionStream,
            };
        },
        onComplete: async ({
            result,
        }: {
            result: GenerateSuggestionResponseDto;
        }) => {
            // Persist the generated suggestion to the database
            try {
                const createResult = await suggestionsService.createSuggestion({
                    name: result.name,
                    description: result.description,
                    difficulty: result.difficulty,
                });

                if (!createResult.success) {
                    console.error(
                        "Failed to persist suggestion:",
                        createResult.error
                    );
                } else {
                    console.log(
                        `Successfully persisted suggestion: ${result.name} (ID: ${createResult.value.id})`
                    );
                }
            } catch (error) {
                console.error("Unexpected error persisting suggestion:", error);
            }
        },
    });
