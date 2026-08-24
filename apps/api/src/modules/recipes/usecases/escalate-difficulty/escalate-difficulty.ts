import { generateStream } from "@fridgeezy/llm";
import {
    difficultyDirection,
    EscalateDifficultyRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    GenerateRecipeResponseDto,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { RecipesRepository } from "@fridgeezy/supabase";

import { DIFFICULTY_RULE } from "../../../suggestions/services/difficulty-rules";
import {
    callerMayReadRecipe,
    createRecipeStream,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
    recordTasteSignal,
    HEADER_DESCRIPTION_RULES,
    TEMPERATURE_RULES,
    STEP_DURATION_RULES,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

const buildSystemPrompt = (
    units: string,
    tags: string,
    currentDifficulty: string,
    targetDifficulty: string
) => `Transform the provided recipe from ${currentDifficulty} difficulty to ${targetDifficulty} difficulty.

## Transformation Rules

### Core Constraints (MUST PRESERVE)
- Keep the recipe NAME exactly as provided (never change it)
- Keep ALL recipe TAGS exactly as provided (dietary restrictions like shellfish-free, vegan, gluten-free must remain unchanged)
- Keep ALL main/core ingredients (proteins, primary vegetables, base components)
- Maintain the same cuisine and dish identity
- Use ONLY unit abbreviations and tags from the approved lists below

${DIFFICULTY_RULE}

### What Should Change Based on Difficulty

When INCREASING difficulty, the target level tells you HOW FAR to go — do not simply
reach for longer sentences and fancier verbs. Rewriting "fry" as "sauté and deglaze"
over the same method is not a harder recipe, it is the same recipe described
differently, and it is the failure mode to avoid here.

- **Make what the easier version buys.** This is the largest single lever and the
  first one to reach for: stock, pasta, pastry, sauces, spice pastes, cures,
  pickles, garnishes. A component made from scratch is real added skill; an
  adjective is not.
- **Cooking Techniques**: Use the technique the dish is genuinely made with at
  this level — emulsifying rather than stirring, rendering and confiting rather
  than roasting, resting and reducing rather than serving straight from the pan.
- **Structure**: Break the method into its real components and say what can be
  made ahead. A dish with three sub-preparations is written as three, not folded
  into one long step.
- **Precision**: Give exact temperatures, timings and visual/textural doneness
  cues where they decide the outcome. Increase step granularity so each step does
  one thing.
- **Finishing**: Say how the dish is plated and garnished, when that is part of
  making it at this level.
- **Ingredients**: Add what those components and techniques genuinely require.
  Never add an ingredient purely to look elaborate.
- **Time**: Increase prepTime and cookTime to reflect the real added work.
- **Nutrition**: Adjust nutritional values (kcal, carbs, protein, fat) based on
  added ingredients and cooking methods

When DECREASING difficulty, you are walking BACK TOWARDS the standard version of
the dish — never below it. "easy" is the real dish cooked properly, so the floor
is a recipe a competent home cook would recognise as the genuine article, not a
shortcut version of it.

- **Cooking Techniques**: Return to the techniques the dish is normally made
  with (e.g. "mix" where the harder version emulsified), not to techniques that
  would change what it is.
- **Components**: Buy in what the harder version makes — stock, pastry, pasta,
  paste — rather than dropping it. The dish keeps every part it had.
- **Ingredients**: Remove garnishes and flourishes the harder version added.
  Core ingredients stay, and so does anything the standard version has.
- **Instructions**: Combine steps where possible, use simpler language, reduce precision requirements
- **Time**: Decrease prepTime and cookTime to reflect simpler preparation
- **Nutrition**: Adjust nutritional values (kcal, carbs, protein, fat) based on removed ingredients and simpler methods

In BOTH directions the dish stays the same dish. A defining ingredient is never
removed to make something simpler, and never buried under additions to make it
harder — see the core constraints above.

### Output Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Each step MUST be authentic and achievable at the target difficulty level
- Times (prepTime, cookTime) MUST be realistic for the target difficulty level
- Nutritional values MUST accurately reflect the adjusted ingredient list
- ALWAYS use unit abbreviations from the approved list below (never invent new units)
- ALWAYS use tag names from the approved list below (never invent new tags)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

## Valid Tags
Use ONLY these tags when tagging recipes. Tags must accurately represent the recipe:

${tags}

## Tagging Rules
- Use EXACTLY the same tags as the original recipe (do not add, remove, or modify any tags)
- Tags include component, cuisine, course, and dietary restriction tags
- Dietary tags (shellfish-free, vegan, gluten-free, etc.) MUST remain unchanged regardless of difficulty

${TEMPERATURE_RULES}

${STEP_DURATION_RULES}

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info (adjust prepTime and cookTime for target difficulty):
{"type":"header","description":"One sentence saying what the dish is","shortDescription":"Short card gloss","prepTime":15,"cookTime":30}
${HEADER_DESCRIPTION_RULES}


Line 2 - Nutrition information (per serving, adjust based on ingredient changes):
{"type":"nutrition","kcal":450,"carbs":35,"protein":25,"fat":15}

Line 3-N - Optional tip lines (MAXIMUM 3 — output the 3 most useful and stop;
extra tips are discarded). Write these HERE, straight after the nutrition line
and before the first ingredient — never at the end:
{"type":"tip","text":"Cooking tip"}

Then one line per ingredient (use approved unit abbreviations only):
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"g"}

Then one line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","title":"Short headline for this step","text":"Step description without number prefix","durationSeconds":600,"temperatureC":180,"equipment":["oven"],"ingredients":["ingredient1","ingredient2"]}

No markdown, no code blocks, just JSONL.`;

const buildUserPrompt = (
    existingRecipe: GenerateRecipeResponseDto,
    targetDifficulty: string
) => {
    const ingredientsList = existingRecipe.ingredients
        .map((ing) => `${ing.quantity}${ing.unit} ${ing.name}`)
        .join("\n");

    const instructionsList = existingRecipe.instructions
        // The headline goes in too. A rewrite regenerates the whole method from
        // this rendering, so a title left out here is a title re-invented from
        // scratch — and a dish's steps would then be headed differently in its
        // base recipe and in every variant of it.
        .map(
            (inst, idx) =>
                `${idx + 1}. ${inst.title ? `${inst.title} — ` : ""}${inst.text}`
        )
        .join("\n");

    const nutritionInfo = `Calories: ${existingRecipe.kcal}kcal, Carbs: ${existingRecipe.carbs}g, Protein: ${existingRecipe.protein}g, Fat: ${existingRecipe.fat}g`;

    return `Transform this recipe to ${targetDifficulty} difficulty:

Recipe Name: ${existingRecipe.name}
Description: ${existingRecipe.description}
Current Difficulty: ${existingRecipe.difficulty}
Servings: ${existingRecipe.servings}
Prep Time: ${existingRecipe.prepTime} min
Cook Time: ${existingRecipe.cookTime} min

Current Nutrition (per serving):
${nutritionInfo}

Current Ingredients:
${ingredientsList}

Current Instructions:
${instructionsList}

${existingRecipe.tips?.length ? `Tips:\n${existingRecipe.tips.map((t) => t.text).join("\n")}` : ""}

Tags: ${existingRecipe.tags.join(", ")}

IMPORTANT CONSTRAINTS:
- Keep recipe name "${existingRecipe.name}" EXACTLY as is
- Use EXACTLY this description in the header: "${existingRecipe.description}"
- Use EXACTLY these tags: ${existingRecipe.tags.join(", ")} (do not add, remove, or modify any tags)
- Keep all core ingredients (proteins, primary vegetables, base components)
- Adjust prepTime and cookTime to be realistic for ${targetDifficulty} difficulty
- Adjust nutritional values based on any ingredient changes
- Modify techniques, optional ingredients, and instruction complexity to match ${targetDifficulty} difficulty`;
};

export const escalateDifficulty = createStreamHandler({
    route: "recipes.escalate",
    requestSchema: EscalateDifficultyRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body, req }) => {
        // 1. Fetch existing recipe
        const existingRecipe = await fetchRecipe(body.id);

        // Owned recipes are readable only by their owner; this fetch runs as the
        // service role and so sees past the RLS that enforces that. Folded into
        // the not-found branch so refusal and absence are indistinguishable —
        // see the sibling check in `modify-recipe.ts`.
        if (
            !existingRecipe ||
            !(await callerMayReadRecipe(existingRecipe.createdBy, req))
        ) {
            throw new Error(`Recipe not found: ${body.id}`);
        }

        // Reuse the existing image rather than regenerating one, and remember
        // which recipe we escalated FROM so the tail of the stream can resolve
        // the family to persist into.
        //
        // Both are `const`s in this handler's closure, and that is load-bearing
        // rather than stylistic: they used to be module-level `let`s assigned
        // here and read below, in `streamWithPersist`, after an await-heavy
        // model stream. Two escalations in flight in one process — a warm
        // Lambda container, or the local server with two tabs open — each
        // overwrote the other's values before either reached its persist. The
        // visible symptom would be a recipe saved with another dish's image;
        // the silent one is `baseRecipeId` resolved from the wrong source,
        // which files the variant under the wrong family and cannot be
        // detected afterwards from the row itself.
        const existingImageUrl: string | undefined = (
            existingRecipe as { imageUrl?: string }
        ).imageUrl;
        const sourceRecipeId: string = body.id;

        // 2. Validate difficulty transition
        if (existingRecipe.difficulty === body.difficulty) {
            throw new Error(
                `Recipe is already at ${body.difficulty} difficulty`
            );
        }

        // The signal is the DIRECTION, not the level. "This cook asked for hard"
        // says nothing on its own — a hard recipe simplified to medium and an
        // easy one pushed to medium are opposite preferences that both record
        // "medium". Which way they reach, repeatedly, is the durable fact.
        // `difficultyDirection` rather than a local rank map. The comment that
        // used to sit on that map argued a second ordering "invites the two to
        // drift into disagreeing about what harder means" — which was right,
        // and was an argument for ONE shared ordering rather than for a private
        // third one. `DIFFICULTY_ORDER` in `@fridgeezy/schemas` is now that
        // copy, and the client's family-collapse reads the same module.
        //
        // It returns undefined for equal or unrecognised levels; equal is
        // already refused above, and an unrecognised one must record NOTHING
        // rather than default to "easier" — a taste signal is only worth having
        // if it is true.
        const signal = difficultyDirection(
            existingRecipe.difficulty,
            body.difficulty
        );

        if (signal) recordTasteSignal(req, "difficulty", signal);

        // 3. Fetch metadata
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 4. Call the model
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            label: "recipe.escalate",
            system: buildSystemPrompt(
                unitsPrompt,
                tagsPrompt,
                existingRecipe.difficulty,
                body.difficulty
            ),
            user: buildUserPrompt(existingRecipe, body.difficulty),
        });

        // 5. Build the recipe stream (initialState sets the base recipe properties)
        const recipeStream = createRecipeStream(stream, {
            schemas: [
                HeaderSchema,
                NutritionSchema,
                IngredientSchema,
                InstructionSchema,
                TipSchema,
            ],
            initialState: {
                name: existingRecipe.name, // MUST remain constant
                nameEn: existingRecipe.nameEn,
                difficulty: body.difficulty, // TARGET difficulty
                servings: existingRecipe.servings,
                tags: existingRecipe.tags, // MUST remain constant
            },
            // No image generation here — escalate reuses the existing
            // recipe's image (passed to persistRecipe as existingImageUrl).
        });

        // 6. Persist INSIDE the stream so the new recipe's id reaches the client.
        //
        // Same reasoning as modify-recipe: the client's done-detector fires on
        // the `complete` frame and then fetches by `recipe.id`, but the recipe
        // stream's own `complete` carries an empty id (the row does not exist
        // yet). Persisting from the generic `onComplete` hook cannot fix that —
        // it runs only after the connection has closed — so the escalated recipe
        // was saved correctly and the client sat there waiting for an id that
        // never came. Hold the id-less frame back, persist, and re-emit
        // `complete` with the real id.
        async function* streamWithPersist() {
            let finalRecipe: GenerateRecipeResponseDto | undefined;

            for await (const frame of recipeStream) {
                if (
                    frame &&
                    typeof frame === "object" &&
                    (frame as { type?: string }).type === "complete"
                ) {
                    finalRecipe = (
                        frame as { recipe: GenerateRecipeResponseDto }
                    ).recipe;
                    // Suppressed; re-emitted below once the row exists.
                    continue;
                }
                yield frame;
            }

            if (!finalRecipe) {
                yield { type: "complete", saved: false };
                return;
            }

            // An escalated recipe keeps the base's name (the prompt forbids
            // changing it), so an untagged row shows up in discovery as a second,
            // indistinguishable "Apfelstrudel". The lineage is resolved BEFORE
            // persisting and handed to the INSERT: inserting as a base and
            // re-parenting afterwards leaves a second base recipe under the
            // base's name in the table for the width of that gap, which the
            // partial unique index rejects outright.
            //
            // No `if (sourceRecipeId)` guard any more: it is `body.id`, which
            // the request schema requires, and the truthiness test only ever
            // read as meaningful while this was a module-level `let` that a
            // concurrent request could leave unset.
            let baseRecipeId: string | null = null;

            const base = await new RecipesRepository().resolveVariantBase(
                sourceRecipeId
            );

            if (base.success) {
                baseRecipeId = base.value;
            } else {
                console.error(
                    "Failed to resolve the escalated recipe's base:",
                    base.error.message
                );
            }

            // Reuse existing image URL instead of generating a new one
            const persistResult = await persistRecipe(
                finalRecipe,
                existingImageUrl,
                baseRecipeId
            );

            if (persistResult.success) {
                console.log(
                    `Escalated recipe persisted with ID: ${persistResult.value}`
                );

                // `id` sits at the TOP LEVEL of the frame, not inside `recipe`.
                // The client accumulates raw frames and reads `frame.id` off the
                // last one, so an id nested in `recipe` is invisible to it —
                // same shape modify-recipe and promote already emit.
                yield {
                    type: "complete",
                    saved: true,
                    id: persistResult.value,
                    recipe: { ...finalRecipe, id: persistResult.value },
                };
            } else {
                console.error(
                    "Failed to persist escalated recipe:",
                    persistResult.error.message
                );
                // Still emit a terminal frame so the client stops streaming.
                yield { type: "complete", saved: false };
            }
        }

        return { type: "stream" as const, stream: streamWithPersist() };
    },
});
