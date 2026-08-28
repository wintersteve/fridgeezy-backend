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
    adaptRecipeForBlacklist,
    compileBlacklist,
    createRecipeStream,
    decideReuse,
    RecipeStreamInitialState,
    fetchRecipeMetadata,
    formatUnitsForPrompt,
    formatTagsForPrompt,
    HEADER_DESCRIPTION_RULES,
    TEMPERATURE_RULES,
    STEP_DURATION_RULES,
    UNIT_CHOICE_RULE,
    INGREDIENT_CATEGORY_GUIDE,
} from "../../../recipes/services";
import {
    generateAndUploadRecipeImage,
    getRecipeImagePublicUrl,
} from "../../../recipes/services/create-recipe-image";
import { persistRecipeWithIngredientIds } from "../../../recipes/services/persist-recipe";
import { fetchEnrichedSuggestion } from "../../services";
import { DIFFICULTY_RULE } from "../../services/difficulty-rules";
import { COMPONENT_RULE, COURSE_RULE, DISH_FORM_RULE } from "../../services/tagging-rules";

/**
 * Build system prompt with explicit ingredient constraints.
 * The LLM MUST use ONLY the provided ingredients.
 *
 * **The ingredient and blacklist blocks go LAST — see the note on
 * `buildRecipeSystemPrompt` in `generate-recipe.ts`, which had the identical
 * defect.** Both are per-request, and while they sat at the top they invalidated
 * the cacheable prefix (units, tags, rules, output format) behind them on every
 * promotion. Do not add anything volatile above this line.
 */
const buildSystemPrompt = (
    units: string,
    tags: string,
    ingredientNames: string[],
    blacklist: string[]
) => `Generate exactly an authentic, real-world recipe based on the provided ingredients

## Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic
- ALWAYS use unit abbreviations from the approved list below (never invent new units)
- ALWAYS use tag names from the approved list below (never invent new tags)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

${UNIT_CHOICE_RULE}

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

${DIFFICULTY_RULE}

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
{"type":"instruction","title":"Short headline for this step","text":"Step description without number prefix","durationSeconds":600,"temperatureC":180,"equipment":["oven"],"ingredients":["ingredient1","ingredient2"]}

No markdown, no code blocks, just JSONL.

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
}`;

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
    /**
     * The estimate the suggestion card was banded from, if it had one.
     *
     * Passed so `prepTime + cookTime` lands in the band the user already saw.
     * Without it the model re-decides the timing from scratch and a card that
     * said "Quick" can open onto a two-hour recipe — the same class of
     * contradiction the fabricated cook time used to produce, just one step
     * later in the flow.
     *
     * Deliberately an ANCHOR, not a constraint. The recipe is the thing that
     * actually knows how long it takes, so a genuine disagreement should be
     * resolved in the recipe's favour and the derived band allowed to differ.
     */
    totalTimeMinutes?: number | null;
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
    totalTimeMinutes,
}: UserPromptInput) =>
    [
        `Generate a detailed ${difficulty} level recipe for: ${name}`,
        gloss
            ? `The dish was offered to the user as: "${gloss}" — write the recipe for THAT dish, and keep "shortDescription" consistent with it.`
            : "",
        // In the USER prompt, never the system one: this is per-request, and the
        // system prompt is the cached prefix every promotion shares. A volatile
        // number above that boundary invalidates the cache on every call — the
        // defect the ingredient and blacklist blocks were moved down to fix.
        totalTimeMinutes
            ? `The card told the user this takes about ${totalTimeMinutes} minutes in total. Aim for prepTime + cookTime near that, EXCLUDING any overnight marinating, chilling or proving. If the authentic recipe genuinely cannot be made in that time, write the honest times — do not compress real cooking to hit the number.`
            : "",
        `Use ONLY these ingredients: ${ingredientNames.join(", ")}`,
        `Servings: ${servings}`,
    ]
        .filter(Boolean)
        .join("\n");

export const promoteSuggestion = createStreamHandler({
    route: "suggestions.promote",
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

        // Both reuse shortcuts below hand back a recipe SOMEBODY ELSE's request
        // generated, so neither may assume it suits this caller. `blacklist` is
        // the one input that makes the right dish the wrong recipe, and it was
        // being consulted only on the generate path — the shortcuts matched on
        // the dish name and stopped there. Compiled once; null when there is
        // nothing to check, which is the common case and skips the family read.
        const blacklist = body.blacklist ?? [];
        const blacklistMatcher = compileBlacklist(blacklist);

        // Set when a shortcut found the dish but could not serve it: the
        // promotion then writes a VARIANT of that family instead of a catalogue
        // entry. Threaded through to the persist call at the bottom.
        let variantBaseId: string | null = null;

        // 0. Promotion is one-way: the suggestion is deleted once its recipe
        // exists. So if this id has already been promoted, hand back that recipe
        // straight away rather than regenerating it — a client that dropped out
        // mid-stream and came back would otherwise pay for the whole recipe a
        // second time (and, since the suggestion is gone, 404 instead).
        const recipesRepository = new RecipesRepository();
        const promotedResult = await recipesRepository.findBySuggestionId(id);

        if (promotedResult.success && promotedResult.value) {
            const promotedId = promotedResult.value;
            const decision = await decideReuse(
                recipesRepository,
                promotedId,
                blacklistMatcher,
                blacklist
            );

            if ("serve" in decision) {
                console.log(
                    `Suggestion ${id} was already promoted to recipe ${decision.serve}`
                );

                return {
                    type: "stream" as const,
                    stream: (async function* () {
                        yield { type: "complete", id: decision.serve };
                    })(),
                };
            }

            // Note what is NOT available here: the suggestion. Promotion deleted
            // it, which is exactly why this shortcut exists — so there is no
            // adapted ingredient list to generate from and no falling through to
            // the path below. The recipe itself is the only source material, so
            // the adaptation is a modification of it.
            console.log(
                `Suggestion ${id} promoted to ${promotedId}, but it contains ${decision.adapt.offending.join(", ")} — adapting as a variant`
            );

            const adaptation = await adaptRecipeForBlacklist({
                recipeId: decision.adapt.recipeId,
                blacklist,
                offending: decision.adapt.offending,
            });

            if (adaptation) {
                return {
                    type: "stream" as const,
                    stream: adaptation.stream,
                };
            }

            // The recipe has gone missing since the lookup. Fall through: the
            // suggestion fetch below answers 404 honestly rather than serving a
            // recipe we could not read.
            console.error(
                `Could not adapt recipe ${decision.adapt.recipeId} for suggestion ${id}`
            );
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
            const decision = await decideReuse(
                recipesRepository,
                existingId,
                blacklistMatcher,
                blacklist
            );

            if ("serve" in decision) {
                console.log(
                    `Suggestion ${id} ("${suggestion.name}") already exists as recipe ${decision.serve} — reusing`
                );

                const suggestionsRepo = new SuggestionsRepository();
                await suggestionsRepo.delete(id);

                return {
                    type: "stream" as const,
                    stream: (async function* () {
                        yield { type: "complete", id: decision.serve };
                    })(),
                };
            }

            // Unlike the shortcut above, the suggestion is still here — and its
            // ingredient list was already written around this caller's blacklist
            // by the generator. So the better adaptation is the ORDINARY
            // generation below, from a clean list, rather than a modification of
            // a recipe built on a dirty one. Don't take the shortcut; write the
            // result into the existing family instead of alongside it.
            //
            // `existingId` is already a base — findByCanonicalName excludes
            // variants — so it is the family id directly.
            variantBaseId = existingId;

            console.log(
                `Suggestion ${id} ("${suggestion.name}") exists as recipe ${existingId}, but it contains ${decision.adapt.offending.join(", ")} — generating a variant`
            );
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
        trackBackgroundTask(
            generateAndUploadRecipeImage(suggestion.name)
        ).catch((error) => {
            console.error("Image generation failed:", error);
        });

        // 6. Call the model
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "suggestions.promote",
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
                totalTimeMinutes: suggestion.totalTimeMinutes,
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
                // Persist using ingredient IDs directly (no canonical_id lookup
                // needed). `variantBaseId` is set only when a reuse shortcut
                // found this dish and could not serve it — the row then joins
                // that family instead of standing beside it as a second base,
                // which the partial unique index would reject anyway.
                const persistResult = await persistRecipeWithIngredientIds(
                    lastResult.recipe,
                    variantBaseId
                );

                if (persistResult.success) {
                    console.log(
                        `Recipe persisted successfully with ID: ${persistResult.value}`
                    );

                    if (variantBaseId) {
                        // Deliberately NEITHER marked as promoted-from NOR
                        // followed by deleting the suggestion.
                        //
                        // `source_suggestion_id` means "the catalogue recipe
                        // this suggestion became", and this is not that — it is
                        // one caller's adaptation. Marking it would also give
                        // the suggestion two promoted recipes, which
                        // `findBySuggestionId` reads with `maybeSingle()` and
                        // would start erroring on. Leaving the suggestion
                        // standing costs nothing: `find_recipes` already hides a
                        // suggestion whose dish has a recipe, and the next
                        // promote of it finds this variant through the family
                        // check rather than generating a second one.
                        yield {
                            ...lastResult,
                            id: persistResult.value,
                            label: "Adapted for you",
                            image: getRecipeImagePublicUrl(
                                lastResult.recipe.name
                            ),
                        };
                        return;
                    }

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

                    // Yield final completion with recipe ID and hero image.
                    //
                    // The image URL is deterministic in the name, so it is the
                    // same string `persistRecipeWithIngredientIds` just wrote to
                    // the row — known here whether or not the (background)
                    // upload has landed. Sending it saves the client a
                    // round-trip it was losing races against: it recorded the
                    // promoted suggestion the moment this id arrived, then had
                    // to wait on a separate recipe fetch for the image, and a
                    // user who backed out first left the card with no image at
                    // all.
                    yield {
                        ...lastResult,
                        id: persistResult.value,
                        image: getRecipeImagePublicUrl(lastResult.recipe.name),
                    };
                } else {
                    console.error(
                        "Failed to persist recipe:",
                        persistResult.error.message
                    );

                    if (variantBaseId) {
                        // No race recovery on this branch, on purpose. The
                        // recovery below reuses the catalogue row under this
                        // name — and on this branch that row is precisely the
                        // one the caller's blacklist ruled out. Better a
                        // completion with no id, which the client reports as a
                        // failed generation, than the recipe they cannot eat.
                        yield lastResult;
                        return;
                    }

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
                        // Same dish name, so the same deterministic URL — the
                        // row that won the race stored this too.
                        yield {
                            ...lastResult,
                            id: raced.value,
                            image: getRecipeImagePublicUrl(
                                lastResult.recipe.name
                            ),
                        };
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
