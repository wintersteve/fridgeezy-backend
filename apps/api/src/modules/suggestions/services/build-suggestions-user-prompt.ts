import { GenerateSuggestionRequestDto } from "@fridgeezy/schemas";
import { castArray } from "@fridgeezy/toolkit";

/**
 * Render a suggestion request as the filter block both suggestion prompts take
 * as their user turn.
 *
 * Shared by the batch generator (`generate-suggestions-stream`) and the single
 * generator (`stream-single-suggestion`), which each carried a byte-identical
 * copy. That duplication was worse than it looks: the model-migration eval only
 * means something if every candidate sees the *same* prompt, and this builder is
 * exported precisely so the harness can reuse it rather than reimplement it. Two
 * copies could drift apart silently and the eval would go on reporting a
 * model difference that was really a prompt difference.
 *
 * Empty filters are dropped rather than sent blank, so a request with no
 * constraints produces no stray `Cuisine: ` lines for the model to read meaning
 * into.
 */
export const buildSuggestionsUserPrompt = (
    request: GenerateSuggestionRequestDto
): string => {
    const formatFilter = (filter: string, value?: string | string[]) => {
        const isValid = Array.isArray(value) ? value.length > 0 : !!value;
        return isValid ? `${filter}: ${castArray(value).join(",")}` : "";
    };

    return [
        formatFilter("Blacklist", request.blacklist),
        formatFilter("Component", request.component),
        formatFilter("Course", request.course),
        formatFilter("Cuisine", request.cuisine),
        formatFilter("Difficulty", request.difficulty),
        formatFilter("Dietary Restrictions", request.dietaryRestrictions),
        formatFilter("Ingredients", request.ingredients),
    ]
        .filter(Boolean)
        .join("\n");
};
