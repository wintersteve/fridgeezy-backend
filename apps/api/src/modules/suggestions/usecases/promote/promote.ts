import { generateStream } from "@fridgeezy/llm";
import {
    PromoteSuggestionRequestSchema,
    HeaderSchema,
    NutritionSchema,
    IngredientSchema,
    InstructionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { RecipesRepository, SuggestionsRepository } from "@fridgeezy/supabase";
import { Request } from "express";

import { trackBackgroundTask } from "../../../../background-tasks";
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
} from "../../../recipes/services";
import { generateAndUploadRecipeImage } from "../../../recipes/services/create-recipe-image";
import { persistRecipeWithIngredientIds } from "../../../recipes/services/persist-recipe";
import { fetchEnrichedSuggestion } from "../../services";

/**
 * Build system prompt with explicit ingredient constraints.
 * The LLM MUST use ONLY the provided ingredients.
 */
const buildSystemPrompt = (
    units: string,
    tags: string,
    ingredientNames: string[],
    blacklist: string[]
) => `Generate exactly an authentic, real-world recipe based on the provided ingredients

## CRITICAL: Ingredient Constraints
You MUST use ONLY these ingredients (no additions, no substitutions):
${ingredientNames.map((name) => `- ${name}`).join("\n")}

When outputting ingredients, use the EXACT names from the list above.
Every instruction step should reference only ingredients from this list.
You MUST provide quantity and unit for EACH ingredient above.
${
    blacklist.length > 0
        ? `
The user cannot eat the following, and the ingredient list above has already been
adapted around them. NEVER reintroduce one — not as an ingredient, not in an
instruction step, not as a garnish, seasoning or serving suggestion, and not in a
tip:
${blacklist.map((name) => `- ${name}`).join("\n")}
`
        : ""
}
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
- EXACTLY 1 component tag per recipe (use "dish" for regular finished dishes/meals)
- 1 OR 2 cuisine tags per recipe. One for almost every dish — its actual origin, as specific as the approved list allows. Add a SECOND only when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican, Nikkei is japanese + peruvian). Never add a second merely to be broader — the region and continent a cuisine belongs to are already known, so "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe. The ONLY valid course tags are: appetizer, dessert, main, side. Pick exactly one of those four — a main dish is "main", a starter is "appetizer", an accompaniment is "side". Never omit it, and never invent another (not "dinner", "lunch", "breakfast", "entree" or "main course").
- AT MOST 1 dish form tag per recipe, and only when the dish clearly IS one: soup, stew, salad, sandwich, wrap, pizza, pasta, noodles, curry, stir fry, roast, bake, casserole, grill, pie, dumpling, rice dish, porridge, pancake, skewer. This is the SHAPE of the dish, not when it is served — a soup served first is still course "appetizer" and form "soup". Omit it entirely for a dish that is simply a plate of food; most dishes have no form.
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

Note: The "comment" field is optional but should be included when the ingredient requires preparation (e.g., "peeled", "deveined", "crushed", "finely chopped", "at room temperature"). Omit if no special preparation is needed.

Then one line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","durationSeconds":600,"temperatureC":180,"ingredients":["ingredient1","ingredient2"]}

No markdown, no code blocks, just JSONL.`;

interface UserPromptInput {
    name: string;
    difficulty: string;
    ingredientNames: string[];
    servings: number;
    /**
     * The suggestion's own card description — the gloss the user read before
     * tapping.
     *
     * Passed in so the recipe is written to the promise the card made: without
     * it, the model re-decides what the dish is from the name and ingredients
     * alone, and the detail screen can end up describing a different take than
     * the card that led there. It also anchors the header's `shortDescription`,
     * which is the same field one step later.
     */
    gloss?: string | null;
}

/**
 * Build user prompt using suggestion data.
 */
const buildUserPrompt = ({
    name,
    difficulty,
    ingredientNames,
    servings,
    gloss,
}: UserPromptInput) =>
    [
        `Generate a detailed ${difficulty} level recipe for: ${name}`,
        gloss ? `The dish was offered to the user as: "${gloss}" — write the recipe for THAT dish, and keep "shortDescription" consistent with it.` : "",
        `Use ONLY these ingredients: ${ingredientNames.join(", ")}`,
        `Servings: ${servings}`,
    ]
        .filter(Boolean)
        .join("\n");

export const promoteSuggestion = createStreamHandler({
    requestSchema: PromoteSuggestionRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body, req }) => {
        // Cast to Express Request to access params
        const expressReq = req as unknown as Request;
        const { id } = expressReq.params;

        if (!id) {
            throw new Error("Suggestion ID is required");
        }

        // 0. Promotion is one-way: the suggestion is deleted once its recipe
        // exists. So if this id has already been promoted, hand back that recipe
        // straight away rather than regenerating it — a client that dropped out
        // mid-stream and came back would otherwise pay for the whole recipe a
        // second time (and, since the suggestion is gone, 404 instead).
        const recipesRepository = new RecipesRepository();
        const promotedResult = await recipesRepository.findBySuggestionId(id);

        if (promotedResult.success && promotedResult.value) {
            const promotedId = promotedResult.value;

            console.log(
                `Suggestion ${id} was already promoted to recipe ${promotedId}`
            );

            return {
                type: "stream" as const,
                stream: (async function* () {
                    yield { type: "complete", id: promotedId };
                })(),
            };
        }

        // 1. Fetch enriched suggestion with ingredients and tags
        const suggestionResult = await fetchEnrichedSuggestion(id);

        if (!suggestionResult.success) {
            const error = suggestionResult.error;

            if (error.name === "NotFoundError") {
                return {
                    type: "raw" as const,
                    statusCode: 404,
                    data: { error: `Suggestion with ID ${id} not found` },
                };
            }

            return {
                type: "raw" as const,
                statusCode: 500,
                data: { error: error.message },
            };
        }

        const suggestion = suggestionResult.value;

        // 1b. Reuse-before-generate: if a recipe for this dish already exists
        // (same canonical name, not a variant), hand it back instead of
        // generating a duplicate. Covers a fresh suggestion for an
        // already-materialised dish, and a concurrent promotion whose sibling
        // already committed. The now-redundant suggestion is deleted.
        const existingByName = await recipesRepository.findByCanonicalName(
            suggestion.name
        );

        if (existingByName.success && existingByName.value) {
            const existingId = existingByName.value;

            console.log(
                `Suggestion ${id} ("${suggestion.name}") already exists as recipe ${existingId} — reusing`
            );

            const suggestionsRepo = new SuggestionsRepository();
            await suggestionsRepo.delete(id);

            return {
                type: "stream" as const,
                stream: (async function* () {
                    yield { type: "complete", id: existingId };
                })(),
            };
        }

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
            system: buildSystemPrompt(
                unitsPrompt,
                tagsPrompt,
                ingredientNames,
                body.blacklist ?? []
            ),
            user: buildUserPrompt({
                name: suggestion.name,
                difficulty: suggestion.difficulty,
                ingredientNames,
                servings: body.servings,
                gloss: suggestion.description,
            }),
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
        async function* wrappedStream(): AsyncGenerator<any> {
            let lastResult: any;

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

                    // Point the recipe back at the suggestion it came from
                    // BEFORE the suggestion is deleted — that id is the only
                    // handle a returning client still has on this recipe.
                    const markResult = await recipesRepository.markPromotedFrom(
                        persistResult.value,
                        id
                    );

                    if (!markResult.success) {
                        console.error(
                            "Failed to record promoted suggestion:",
                            markResult.error.message
                        );
                    }

                    // Delete the suggestion after successful recipe creation
                    const suggestionsRepo = new SuggestionsRepository();
                    const deleteResult = await suggestionsRepo.delete(id);

                    if (deleteResult.success) {
                        console.log(
                            `Suggestion ${id} removed after promotion to recipe`
                        );
                    } else {
                        console.error(
                            "Failed to delete suggestion:",
                            deleteResult.error.message
                        );
                    }

                    // Yield final completion with recipe ID
                    yield {
                        ...lastResult,
                        id: persistResult.value,
                    };
                } else {
                    console.error(
                        "Failed to persist recipe:",
                        persistResult.error.message
                    );

                    // A concurrent promotion of the same dish may have committed
                    // the recipe between our reuse check and this insert (once the
                    // partial unique index is in place, that insert fails here).
                    // Reuse the row that won rather than returning no id.
                    const raced = await recipesRepository.findByCanonicalName(
                        lastResult.recipe.name
                    );

                    if (raced.success && raced.value) {
                        const suggestionsRepo = new SuggestionsRepository();
                        await suggestionsRepo.delete(id);
                        yield { ...lastResult, id: raced.value };
                    } else {
                        // Yield completion without ID if persistence failed
                        yield lastResult;
                    }
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
