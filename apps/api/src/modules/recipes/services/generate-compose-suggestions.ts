import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    ComposeRecipeRequestDto,
    ComposeRecipeResultDto,
    ComposeRecipeProgressDto,
    GenerateRecipeResponseDto,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import { FOOD_ONLY_RULE } from "../../suggestions/services/constraint-rules";
import {
    DISH_GLOSS_RULE,
    DISH_NAME_ALT_RULE,
    DISH_NAME_RULE,
} from "../../suggestions/services/naming-rules";
import { persistOrReuseSuggestion } from "../../suggestions/services/persist-or-reuse-suggestion";

import { fetchRecipeMetadata } from "./fetch-recipe-metadata";

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
- ${FOOD_ONLY_RULE}
  - This applies to PAIRINGS too. A wine or cocktail that would go well with the base recipe is still a drink, and a menu course here is always something eaten.
- Do NOT suggest recipes of excluded course types
- If cuisine matching is requested, suggest recipes from the same cuisine
- If difficulty matching is requested, suggest recipes of similar difficulty

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques
- "medium": The standard authentic recipe with its usual techniques
- "hard": Elevated or advanced version with more complex techniques

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe (use "dish" for finished dishes)
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe: the course type being suggested. The ONLY valid course tags are: appetizer, dessert, main, side. Never omit it, and never invent another (not "starter", "dinner", "entree" or "main course") — a starter is "appetizer".
- AT MOST 1 dish form tag per recipe, and only when the dish clearly IS one: soup, stew, salad, sandwich, wrap, pizza, pasta, noodles, curry, stir fry, roast, bake, casserole, grill, pie, dumpling, rice dish, porridge, pancake, skewer. This is the SHAPE of the dish, not when it is served — a soup served first is still course "appetizer" and form "soup". Omit it entirely for a dish that is simply a plate of food; most dishes have no form.
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
    courseTagNames: string[],
    cuisineTagNames: string[]
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

    // Matched against the actual cuisine vocabulary. This used to take the first
    // tag that was neither a course nor "dish", which also matches DIETARY tags —
    // a vegan Italian dish could send the model "Cuisine: vegan". A recipe may
    // now carry two cuisines (a genuine fusion dish), and both are worth sending:
    // the complementary course should fit the whole dish, not half its heritage.
    const cuisineTags = baseRecipe.tags.filter((tag) =>
        cuisineTagNames.some(
            (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
        )
    );

    const parts = [
        `Base Recipe: ${baseRecipe.name}`,
        `Description: ${baseRecipe.description}`,
        `Key Ingredients: ${baseRecipe.ingredients
            .slice(0, 5)
            .map((i) => i.name)
            .join(", ")}`,
    ];

    if (request.matchCuisine && cuisineTags.length > 0) {
        parts.push(`Cuisine: ${cuisineTags.join(", ")}`);
    }

    if (request.matchDifficulty) {
        parts.push(`Difficulty: ${baseRecipe.difficulty}`);
    }

    parts.push(`\nRequested Courses: ${allowedCourses.join(", ")}`);

    if (baseCourses.length > 0) {
        parts.push(`Excluded Courses: ${baseCourses.join(", ")}`);
    }

    parts.push(`Max Suggestions: ${request.maxSuggestions} per course type`);

    if (request.exclude.length > 0) {
        parts.push(
            `\nAlready offered — do NOT suggest these or a variant of them: ${request.exclude.join(", ")}`
        );
    }

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
    const cuisineTagNames = metadata.tags
        .filter((tag) => tag.type === "cuisine")
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

    const excluded = new Set(
        request.exclude.map((name) => name.toLowerCase().trim())
    );

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "recipe.compose",
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(
            baseRecipe,
            request,
            courseTagNames,
            cuisineTagNames
        ),
        provider,
    });

    // Process JSONL stream with validation
    for await (const { parsed } of processJsonlStream(stream, [
        ComposeRecipeSuggestionSchema,
    ])) {
        const suggestion = parsed as ComposeRecipeSuggestion;

        // The prompt asks for these to be avoided; enforce it too, so a model
        // that ignores the instruction can't hand a client back the dish it
        // explicitly asked to move on from.
        if (
            excluded.has(suggestion.name.toLowerCase().trim()) ||
            (suggestion.name_alt &&
                excluded.has(suggestion.name_alt.toLowerCase().trim()))
        ) {
            continue;
        }

        // Yield search progress
        yield {
            type: "progress",
            stage: "searching",
            courseType: suggestion.course,
            message: `Searching for "${suggestion.name}"`,
        };

        // Identity is decided exactly as it is for the discovery feed. This used
        // to run its own weaker chain — a vector search on the BARE DISH NAME,
        // then an exact-name lookup among suggestions. Both were broken:
        //
        //  - `recipes.embedding` holds a dish SIGNATURE ("name | tags |
        //    ingredients", see persist-recipe), so querying it with a bare-name
        //    vector compares two different kinds of text. Real matches scored
        //    below the caller's threshold and the dish was regenerated, which is
        //    why a course whose recipe plainly existed was never reused.
        //  - There was no exact-name layer over `recipes` at all, so not even a
        //    literal name match could rescue it.
        //
        // `persistOrReuseSuggestion` already does the whole thing: recipes by
        // exact name then signature similarity, suggestions by exact name then
        // the calibrated band with LLM adjudication, plus the authenticity gate.
        const outcome = await persistOrReuseSuggestion(suggestion, {
            // The cuisine tag the model gave this dish — not a course, not the
            // "dish" component marker.
            cuisine: suggestion.tags.find(
                (tag) =>
                    !courseTagNames.some((course) =>
                        tag.toLowerCase().includes(course.toLowerCase())
                    ) && tag.toLowerCase() !== "dish"
            ),
        });

        if (outcome.kind === "dropped") {
            console.warn(
                `[Compose] Dropped "${suggestion.name}" (${outcome.reason})`
            );
            continue;
        }

        if (outcome.kind === "existing_recipe") {
            const recipe = outcome.recipe;
            yield {
                type: "result",
                source: "existing",
                id: recipe.id,
                name: recipe.name,
                nameEn: recipe.nameEn,
                description: recipe.description,
                difficulty: recipe.difficulty,
                ingredients: recipe.ingredients,
                tags: recipe.tags,
                image: recipe.image,
            };
            continue;
        }

        const reused = outcome.suggestion;
        yield {
            type: "result",
            source: "suggestion",
            id: reused.id,
            name: reused.name,
            nameEn: reused.nameEn,
            description: reused.description,
            difficulty: reused.difficulty,
            ingredients: reused.ingredients,
            tags: reused.tags,
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
