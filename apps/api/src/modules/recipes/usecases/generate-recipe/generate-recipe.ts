import { generateStream } from "@fridgeezy/llm";
import {
    GenerateRecipeRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { SuggestionsRepository } from "@fridgeezy/supabase";

import { trackBackgroundTask } from "../../../../background-tasks";
import { fetchEnrichedSuggestion } from "../../../suggestions/services";
import {
    COMPONENT_RULE,
    COURSE_RULE,
    DISH_FORM_RULE,
} from "../../../suggestions/services/tagging-rules";
import {
    createRecipeStream,
    RecipeStreamInitialState,
    fetchRecipeMetadata,
    formatUnitsForPrompt,
    formatTagsForPrompt,
    HEADER_DESCRIPTION_RULES,
    TEMPERATURE_RULES,
    STEP_DURATION_RULES,
    INGREDIENT_CATEGORY_GUIDE,
} from "../../services";
import { generateAndUploadRecipeImage } from "../../services/create-recipe-image";
import { persistRecipeWithIngredientIds } from "../../services/persist-recipe";

/**
 * Build system prompt with explicit ingredient constraints.
 * The LLM MUST use ONLY the provided ingredients.
 *
 * Exported for the model-migration eval harness, which must send byte-identical
 * prompts to every candidate — a copy in the eval would drift and invalidate the
 * comparison.
 *
 * **The ingredient block goes LAST, and that ordering is load-bearing.** Prompt
 * caching — automatic on OpenAI, explicit on Anthropic, prefix-matched on both —
 * keys on the longest identical *prefix*. `ingredientNames` is the one thing here
 * that changes on every single request, so while it sat at line 3 it invalidated
 * the whole prompt behind it: the units table, the tag list, the category guide,
 * the tagging and duration rules and the entire output format, none of which ever
 * change, were re-billed at full price on every recipe. This is the largest
 * prompt in the app and it cached nothing.
 *
 * Moving the block to the end costs nothing semantically — it is the same
 * instruction in the same message — and recency arguably helps adherence. But it
 * is still a prompt change, so `step-structure.eval.ts` (which measures exactly
 * this constraint: do steps reference only listed ingredients) needs re-running to
 * re-baseline. Do not add anything volatile above this line.
 */
export const buildRecipeSystemPrompt = (
    units: string,
    tags: string,
    ingredientNames: string[]
) => `Generate exactly an authentic, real-world recipe based on the provided ingredients

## Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic
- ALWAYS use unit abbreviations from the approved list below (never invent new units)
- ALWAYS use tag names from the approved list below (never invent new tags)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

## Valid Tags
Use ONLY these tags when tagging recipes. Tags must accurately represent the recipe:

${tags}

## Valid Ingredient Categories
Set each ingredient's "category" to EXACTLY one of these ids (the id, not the description):
${INGREDIENT_CATEGORY_GUIDE}

## Tagging Rules
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin, as specific as the approved list allows. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- ${COURSE_RULE}
- ${DISH_FORM_RULE}
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Difficulty Levels
- "easy": Beginner-friendly version of the dish, using simple techniques while keeping ingredients authentic.
- "medium": The standard authentic recipe with its usual techniques.
- "hard": Elevated or advanced version of the dish, which may include optional ingredients or more complex techniques.

${TEMPERATURE_RULES}

${STEP_DURATION_RULES}

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","name":"Recipe Name","description":"One sentence saying what the dish is","shortDescription":"Short card gloss","difficulty":"easy","servings":4,"prepTime":15,"cookTime":30,"tags":["tag1","tag2"]}
${HEADER_DESCRIPTION_RULES}


Line 2 - Nutrition information (per serving):
{"type":"nutrition","kcal":450,"carbs":35,"protein":25,"fat":15}

Line 3-N - Optional tip lines (MAXIMUM 3 — output the 3 most useful and stop;
extra tips are discarded). Write these HERE, straight after the nutrition line
and before the first ingredient — never at the end:
{"type":"tip","text":"Cooking tip"}

Then one line per ingredient (use approved unit abbreviations only):
{"type":"ingredient","name":"ingredient_name","category":"meats","parent":"lamb","quantity":100,"unit":"g","comment":"peeled and diced"}

Note: The "name" must be the plain ingredient only — NEVER include parentheses or qualifiers in the name (write "chicken breast", NOT "chicken breast (boneless)"). Any qualifier, preparation, or note MUST go in the "comment" field instead. The "comment" field is optional but should be included when the ingredient requires preparation or has a qualifier (e.g., "boneless", "peeled", "deveined", "crushed", "finely chopped", "at room temperature"). Omit if none is needed.

Then one line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","title":"Short headline for this step","text":"Step description without number prefix","durationSeconds":600,"temperatureC":180,"equipment":["oven"],"ingredients":["ingredient1","ingredient2"]}

No markdown, no code blocks, just JSONL.

## CRITICAL: Ingredient Constraints
You MUST use ONLY these ingredients (no additions, no substitutions):
${ingredientNames.map((name) => `- ${name}`).join("\n")}

When outputting ingredients, use the EXACT names from the list above.
Every instruction step should reference only ingredients from this list.
You MUST provide quantity and unit for EACH ingredient above.`;

/**
 * Build user prompt using suggestion data. Exported alongside
 * `buildRecipeSystemPrompt` for the model-migration eval harness.
 *
 * **Deliberately carries nothing about the caller.** What this writes is
 * persisted with `created_by NULL` — a SHARED catalogue row that
 * `findByCanonicalName` then serves to the next person who promotes the same
 * dish. Personalising it would put one cook's preferences in front of everyone
 * else, and with one catalogue slot per dish+difficulty, whoever promoted first
 * would define the dish for all of them. Standing preferences apply through the
 * VARIANT path instead — see `personalise-recipe`.
 */
export const buildRecipeUserPrompt = (
    name: string,
    difficulty: string,
    ingredientNames: string[],
    servings: number
) => `Generate a detailed ${difficulty} level recipe for: ${name}
Use ONLY these ingredients: ${ingredientNames.join(", ")}
Servings: ${servings}`;

export const generateRecipe = createStreamHandler({
    requestSchema: GenerateRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        // 1. Fetch enriched suggestion with ingredients and tags
        const suggestionResult = await fetchEnrichedSuggestion(body.suggestionId);

        if (!suggestionResult.success) {
            const error = suggestionResult.error;

            if (error.name === "NotFoundError") {
                return {
                    type: "raw" as const,
                    statusCode: 404,
                    data: { error: `Suggestion with ID ${body.suggestionId} not found` },
                };
            }

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: error.message },
            };
        }

        const suggestion = suggestionResult.value;

        // 2. Create ingredient ID map (lowercase name -> UUID)
        const ingredientIdMap = new Map<string, string>();
        for (const ing of suggestion.ingredients) {
            ingredientIdMap.set(ing.name.toLowerCase(), ing.id);
        }

        // 3. Extract ingredient names for prompt
        const ingredientNames = suggestion.ingredients.map((i) => i.name);
        const tagNames = suggestion.tags.map((t) => t.name);

        // 4. Fetch metadata from Supabase
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 5. Build initial state for stream
        const initialState: RecipeStreamInitialState = {
            name: suggestion.name,
            nameEn: suggestion.nameEn,
            difficulty: suggestion.difficulty,
            servings: body.servings,
            tags: tagNames,
        };

        // Kick off image generation now (name is known), so it runs in parallel
        // with the entire recipe generation instead of waiting for the header.
        // Fire-and-forget: persistence reads the deterministic URL either way.
        // Tracked so Lambda can let it finish before freezing the environment.
        trackBackgroundTask(generateAndUploadRecipeImage(suggestion.name)).catch((error) => {
            console.error("Image generation failed:", error);
        });

        // 6. Call the model
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "recipe.generate",
            system: buildRecipeSystemPrompt(unitsPrompt, tagsPrompt, ingredientNames),
            user: buildRecipeUserPrompt(
                suggestion.name,
                suggestion.difficulty,
                ingredientNames,
                body.servings
            ),
        });

        // 7. Create recipe stream with ingredient ID map
        const recipeStream = createRecipeStream(stream, {
            schemas: [
                HeaderSchema,
                NutritionSchema,
                IngredientSchema,
                InstructionSchema,
                TipSchema,
            ],
            initialState,
            ingredientIdMap,
        });

        // 8. Wrap stream to persist recipe and delete suggestion
        async function* wrappedStream() {
            let lastResult;

            for await (const chunk of recipeStream) {
                lastResult = chunk;

                // Yield all chunks except the final completion
                if (chunk.type !== "complete") {
                    yield chunk;
                }
            }

            // After stream completes, persist the recipe and yield final message with ID
            if (lastResult?.type === "complete" && lastResult.recipe) {
                // Persist using ingredient IDs directly (no canonical_id lookup needed)
                const persistResult = await persistRecipeWithIngredientIds(lastResult.recipe);

                if (persistResult.success) {
                    console.log(
                        `Recipe persisted successfully with ID: ${persistResult.value}`
                    );

                    // Delete the suggestion after successful recipe creation
                    const suggestionsRepo = new SuggestionsRepository();
                    const deleteResult = await suggestionsRepo.delete(body.suggestionId);

                    if (deleteResult.success) {
                        console.log(
                            `Suggestion ${body.suggestionId} removed after promotion to recipe`
                        );
                    } else {
                        console.error(
                            "Failed to delete suggestion:",
                            deleteResult.error.message
                        );
                    }

                    // Fold the persisted id into the terminal frame under `id` —
                    // the key the client's done-detector reads. It was `recipeId`,
                    // which nothing consumes, so a client would have completed the
                    // stream with no id and waited forever for a recipe that had
                    // in fact been saved (the failure escalate-difficulty hit).
                    yield {
                        ...lastResult,
                        id: persistResult.value,
                    };
                } else {
                    console.error(
                        "Failed to persist recipe:",
                        persistResult.error.message
                    );
                    // Yield completion without ID if persistence failed
                    yield lastResult;
                }
            } else if (lastResult) {
                // Yield the last result if it wasn't a complete type
                yield lastResult;
            }
        }

        return {
            type: "stream" as const,
            stream: wrappedStream(),
        };
    },
});
