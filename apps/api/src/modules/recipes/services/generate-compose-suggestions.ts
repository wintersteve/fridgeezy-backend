import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    ComposeRecipeRequestDto,
    ComposeRecipeResultDto,
    ComposeRecipeProgressDto,
    GenerateRecipeResponseDto,
    GenerateSuggestionResponseSchema,
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
import {
    COMPONENT_RULE,
    DISH_FORM_RULE,
    TAGS_KEY_RULE,
} from "../../suggestions/services/tagging-rules";
import { DISH_TOTAL_TIME_RULE } from "../../suggestions/services/timing-rules";

import { fetchRecipeMetadata } from "./fetch-recipe-metadata";

/**
 * Schema for LLM-generated composition suggestions (JSONL format)
 */
const ComposeRecipeSuggestionSchema = z.object({
    name: z.string(),
    name_alt: z.string().nullable().optional(),
    description: z.string().trim(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    // Borrowed from the shared schema rather than restated. The parsed object is
    // handed straight to `persistOrReuseSuggestion`, which types it as
    // `GenerateSuggestionResponseDto` — so a hand-written copy here would have to
    // keep the coercion, bounds and the load-bearing optional/catch order in
    // step with that file forever, and nothing would report it drifting.
    total_time_minutes: GenerateSuggestionResponseSchema.shape.total_time_minutes,
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
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe: the course type being suggested. The ONLY valid course tags are: appetizer, dessert, main, side. Never omit it, and never invent another (not "starter", "dinner", "entree" or "main course") — a starter is "appetizer".
- ${DISH_FORM_RULE}
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
- ${DISH_TOTAL_TIME_RULE}
- course (the course type)
- ingredients (array of key ingredient strings)
- ${TAGS_KEY_RULE}`;

/**
 * Which course slots the base recipe already fills, and which of the requested
 * ones are therefore still open.
 *
 * Computed ONCE and handed to both callers. It used to be duplicated verbatim in
 * `buildUserPrompt` and `generateComposeRecipes` — two copies of the rule that
 * decides what the composer may suggest, free to drift into disagreeing about
 * what the user asked for.
 *
 * Matched by EXACT name, not `includes`. The loose form was a false-positive
 * waiting to happen — any tag whose name merely contained a course word counted
 * as that course — and it is the same defect the cuisine lookup below carries a
 * comment about having already fixed. Every caller sends the vocabulary verbatim
 * (`["appetizer", "main", "side", "dessert"]`, see the client's COURSE_ORDER), so
 * exact matching loses nothing.
 */
const splitCourses = (
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    courseTagNames: string[]
): { base: string[]; allowed: string[] } => {
    const base = baseRecipe.tags.filter((tag) =>
        courseTagNames.some(
            (course) => tag.toLowerCase() === course.toLowerCase()
        )
    );

    const allowed = request.courseTypes.filter(
        (course) =>
            !base.some(
                (baseCourse) =>
                    baseCourse.toLowerCase() === course.toLowerCase()
            )
    );

    return { base, allowed };
};

const buildUserPrompt = (
    baseRecipe: GenerateRecipeResponseDto & { imageUrl?: string },
    request: ComposeRecipeRequestDto,
    courses: { base: string[]; allowed: string[] },
    cuisineTagNames: string[]
): string => {
    const baseCourses = courses.base;
    const allowedCourses = courses.allowed;

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

    // Validate that we have allowed courses. The same split is handed to
    // `buildUserPrompt` below rather than recomputed there.
    const courses = splitCourses(baseRecipe, request, courseTagNames);
    const allowedCourses = courses.allowed;

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
        user: buildUserPrompt(baseRecipe, request, courses, cuisineTagNames),
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
            // The cuisine tag the model gave this dish, matched against the
            // actual cuisine vocabulary — the same way `buildUserPrompt` above
            // resolves the BASE recipe's cuisine, and for the same reason.
            //
            // This used to take the first tag that was neither a course nor
            // "dish", which also matches DIETARY tags: a vegan Italian dish
            // handed dedup "vegan" as its cuisine. That is worse than handing it
            // nothing, because cuisine is an identity signal — two dishes agreeing
            // on "vegan" look related when they are not.
            //
            // It also quietly depended on the `dish` component marker existing to
            // exclude it. Matching positively removes that coupling, which is
            // what lets the marker be dropped.
            //
            // A cuisine the model invents in THIS batch is not in the snapshot
            // taken at the top of this function, so it resolves to undefined
            // rather than being caught. That is the right trade: `cuisine` is an
            // optional hint, and no hint beats a wrong one. `matchTags` still
            // creates the tag during persistence, so the next call sees it.
            cuisine: suggestion.tags.find((tag) =>
                cuisineTagNames.some(
                    (cuisine) => tag.toLowerCase() === cuisine.toLowerCase()
                )
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
                totalTimeMinutes: recipe.totalTimeMinutes,
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
            totalTimeMinutes: reused.totalTimeMinutes,
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
