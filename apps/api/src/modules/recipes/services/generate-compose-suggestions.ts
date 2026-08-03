import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    ComposeRecipeRequestDto,
    ComposeRecipeResultDto,
    ComposeRecipeProgressDto,
    GenerateRecipeResponseDto,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import { findSuggestionByName } from "../../suggestions/services/find-suggestion-by-name";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "../../suggestions/services/naming-rules";
import { persistSuggestion } from "../../suggestions/services/persist-suggestion";

import { fetchRecipeMetadata } from "./fetch-recipe-metadata";
import { fetchRecipeSummary } from "./fetch-recipe-summary";
import { searchRecipes } from "./search-recipes";

/**
 * Schema for LLM-generated composition suggestions (JSONL format)
 */
const ComposeRecipeSuggestionSchema = z.object({
    name: z.string(),
    name_alt: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    course: z.string(),
    ingredients: z.array(z.string().min(1)),
    tags: z.array(z.string()),
});

type ComposeRecipeSuggestion = z.infer<typeof ComposeRecipeSuggestionSchema>;

const SYSTEM_PROMPT = `You are a recipe composition assistant. Generate complementary courses for a given base recipe.

## Rules
- Suggest authentic, real-world recipes that complement the base recipe
- Each recipe MUST be a real dish (not invented, must be authentic), named by the rule under "Output Format" below
- Do NOT suggest recipes of excluded course types
- If cuisine matching is requested, suggest recipes from the same cuisine
- If difficulty matching is requested, suggest recipes of similar difficulty

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques
- "medium": The standard authentic recipe with its usual techniques
- "hard": Elevated or advanced version with more complex techniques

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe (use "dish" for finished dishes)
- EXACTLY 1 cuisine tag per recipe (the most accurate cuisine origin)
- EXACTLY 1 course tag per recipe (the course type being suggested)
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free)

## Ingredients
- MUST be singular
- Include key ingredients that define the dish

## Output Format
Output one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

Each recipe object must include:
- ${DISH_NAME_RULE}
- ${DISH_NAME_ALT_RULE}
- ${DISH_GLOSS_RULE}
- difficulty (easy, medium, or hard)
- course (the course type)
- ingredients (array of key ingredient strings)
- tags (array of strings with component, cuisine, course, and dietary tags)`;

const buildUserPrompt = (
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    courseTagNames: string[]
): string => {
    // Extract course tags from base recipe using DB course tags
    const baseCourses = baseRecipe.tags.filter((tag) =>
        courseTagNames.some((course) =>
            tag.toLowerCase().includes(course.toLowerCase())
        )
    );

    // Filter requested courses to exclude base courses
    const allowedCourses = request.courseTypes.filter(
        (course) =>
            !baseCourses.some((baseCourse) =>
                baseCourse.toLowerCase().includes(course.toLowerCase())
            )
    );

    // Extract cuisine tag (find tag that is NOT a course tag and NOT "dish")
    const cuisineTag = baseRecipe.tags.find(
        (tag) =>
            !courseTagNames.some((course) =>
                tag.toLowerCase().includes(course.toLowerCase())
            ) && tag.toLowerCase() !== "dish"
    );

    const parts = [
        `Base Recipe: ${baseRecipe.name}`,
        `Description: ${baseRecipe.description}`,
        `Key Ingredients: ${baseRecipe.ingredients
            .slice(0, 5)
            .map((i) => i.name)
            .join(", ")}`,
    ];

    if (request.matchCuisine && cuisineTag) {
        parts.push(`Cuisine: ${cuisineTag}`);
    }

    if (request.matchDifficulty) {
        parts.push(`Difficulty: ${baseRecipe.difficulty}`);
    }

    parts.push(`\nRequested Courses: ${allowedCourses.join(", ")}`);

    if (baseCourses.length > 0) {
        parts.push(`Excluded Courses: ${baseCourses.join(", ")}`);
    }

    parts.push(`Max Suggestions: ${request.maxSuggestions} per course type`);
    parts.push(`\nGenerate authentic complementary dishes.`);

    return parts.join("\n");
};

/**
 * Generate composition suggestions for complementary courses.
 * Uses LLM to suggest recipes, then searches for existing recipes or creates new suggestions.
 *
 * @param baseRecipe The recipe to compose with
 * @param request Composition parameters (course types, matching preferences, etc.)
 * @param provider Overrides `LLM_PROVIDER` for this call, to A/B the two
 * @yields Progress updates and recipe results
 */
export async function* generateComposeRecipes(
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    provider?: LlmProvider
): AsyncGenerator<ComposeRecipeResultDto | ComposeRecipeProgressDto> {
    // Fetch metadata to get course tags from database
    const metadata = await fetchRecipeMetadata();
    const courseTagNames = metadata.tags
        .filter((tag) => tag.type === "course")
        .map((tag) => tag.name);

    // Validate that we have allowed courses
    const baseCourses = baseRecipe.tags.filter((tag) =>
        courseTagNames.some((course) =>
            tag.toLowerCase().includes(course.toLowerCase())
        )
    );
    const allowedCourses = request.courseTypes.filter(
        (course) =>
            !baseCourses.some((baseCourse) =>
                baseCourse.toLowerCase().includes(course.toLowerCase())
            )
    );

    if (allowedCourses.length === 0) {
        throw new Error(
            "All requested course types are already present in base recipe"
        );
    }

    // Yield initial progress
    yield {
        type: "progress",
        stage: "generating",
        courseType: allowedCourses.join(", "),
        message: `Generating ${allowedCourses.length} course type(s)`,
    };

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(baseRecipe, request, courseTagNames),
        provider,
    });

    // Process JSONL stream with validation
    for await (const { parsed } of processJsonlStream(stream, [
        ComposeRecipeSuggestionSchema,
    ])) {
        const suggestion = parsed as ComposeRecipeSuggestion;

        // Yield search progress
        yield {
            type: "progress",
            stage: "searching",
            courseType: suggestion.course,
            message: `Searching for "${suggestion.name}"`,
        };

        // Search for existing recipes
        const searchResults = await searchRecipes(
            suggestion.name,
            request.matchThreshold,
            1 // Only need top match
        );

        if (
            searchResults.length > 0 &&
            searchResults[0].score >= request.matchThreshold
        ) {
            // Found existing recipe - fetch full summary with ingredients/tags
            const match = searchResults[0];
            const recipeSummary = await fetchRecipeSummary(match.id);

            if (!recipeSummary) {
                console.error(
                    `[Compose] Recipe not found: ${match.id}, searching suggestions instead`
                );
                // Fall through to search suggestions
            } else {
                yield {
                    type: "result",
                    source: "existing",
                    id: recipeSummary.id,
                    name: recipeSummary.name,
                    nameEn: recipeSummary.nameEn,
                    description: recipeSummary.description,
                    difficulty: recipeSummary.difficulty,
                    ingredients: recipeSummary.ingredients,
                    tags: recipeSummary.tags,
                    matchScore: match.score,
                };
                continue; // Move to next suggestion
            }
        }

        // No recipe match found - search for existing suggestion by exact name
        const existingSuggestion = await findSuggestionByName(suggestion.name);

        if (existingSuggestion) {
            yield {
                type: "result",
                source: "suggestion",
                id: existingSuggestion.id,
                name: existingSuggestion.name,
                nameEn: existingSuggestion.nameEn,
                description: existingSuggestion.description,
                difficulty: existingSuggestion.difficulty,
                ingredients: existingSuggestion.ingredients,
                tags: existingSuggestion.tags,
            };
            continue; // Move to next suggestion
        }

        // No match found - create new suggestion
        // Extract cuisine tag from suggestion tags (not a course, not "dish")
        const suggestionCuisine = suggestion.tags.find(
            (tag) =>
                !courseTagNames.some((course) =>
                    tag.toLowerCase().includes(course.toLowerCase())
                ) && tag.toLowerCase() !== "dish"
        );

        const persistResult = await persistSuggestion(
            {
                name: suggestion.name,
                name_alt: suggestion.name_alt,
                description: suggestion.description,
                difficulty: suggestion.difficulty,
                ingredients: suggestion.ingredients,
                tags: suggestion.tags,
            },
            { cuisineTag: suggestionCuisine, nameEn: suggestion.name_alt }
        );

        if (!persistResult.success) {
            console.error(
                `[Compose] Failed to persist suggestion: ${suggestion.name}`,
                persistResult.error
            );
            continue;
        }

        yield {
            type: "result",
            source: "suggestion",
            id: persistResult.value.suggestionId,
            name: suggestion.name,
            nameEn: suggestion.name_alt,
            description: suggestion.description,
            difficulty: suggestion.difficulty,
            ingredients: persistResult.value.ingredients,
            tags: persistResult.value.tags,
        };
    }

    // Yield completion
    yield {
        type: "progress",
        stage: "complete",
        courseType: "",
        message: "Composition complete",
    };
}
