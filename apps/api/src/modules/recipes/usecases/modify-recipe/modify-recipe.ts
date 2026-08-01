import { generateStream } from "@fridgeezy/llm";
import {
    ModifyRecipeRequestSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    GenerateRecipeResponseDto,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { createStreamHandler } from "@fridgeezy/streaming-server";
import { RecipesRepository } from "@fridgeezy/supabase";

import {
    createRecipeStream,
    fetchRecipe,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../../services";
import { persistRecipe } from "../../services/persist-recipe";

const buildSystemPrompt = (
    units: string,
    tags: string
) => `Apply the user's requested modification to the provided recipe, producing a new version of the SAME dish.

## Transformation Rules

### Core Constraints (MUST PRESERVE)
- Keep the recipe NAME exactly as provided (never change it)
- Keep the same difficulty level as provided
- Keep the dish identity and cuisine — this is a variation of the same dish, not a new recipe
- Keep ALL recipe TAGS exactly as provided
- Use ONLY unit abbreviations and tags from the approved lists below

### What May Change
- Ingredients, quantities, and cooking techniques as needed to satisfy the request
- Instructions, prep/cook time, and nutrition to accurately reflect the changes
- When honouring a dietary restriction, replace non-compliant ingredients with authentic substitutes (do NOT simply omit core components)

### Output Rules
- For each instruction step, include an "ingredients" array listing the ingredient names used in that specific step
- Times (prepTime, cookTime) and nutrition MUST accurately reflect the modified ingredient list
- ALWAYS use unit abbreviations from the approved list below (never invent new units)

## Valid Unit Abbreviations
Use ONLY these unit abbreviations when specifying ingredient quantities:

${units}

## Valid Tags
Reference only (keep the recipe's existing tags unchanged):

${tags}

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","description":"Brief description","shortDescription":"One-line card description","prepTime":15,"cookTime":30}
The two description fields are different lengths and both are required:
- "description": 2-3 sentences for the recipe detail screen.
- "shortDescription": ONE short sentence (max 60 characters) for recipe cards, which show a single line. Must read as a complete phrase, never a truncation of "description".


Line 2 - Nutrition information (per serving):
{"type":"nutrition","kcal":450,"carbs":35,"protein":25,"fat":15}

Line 3-N - Optional tip lines (MAXIMUM 3 — output the 3 most useful and stop;
extra tips are discarded). Write these HERE, straight after the nutrition line
and before the first ingredient — never at the end:
{"type":"tip","text":"Cooking tip"}

Then one line per ingredient (use approved unit abbreviations only):
{"type":"ingredient","name":"ingredient_name","category":"meat","parent":"lamb","quantity":100,"unit":"g"}

Then one line per instruction step (include ingredients array with names of ingredients used in this step):
{"type":"instruction","text":"Step description without number prefix","ingredients":["ingredient1","ingredient2"]}

No markdown, no code blocks, just JSONL.`;

const buildUserPrompt = (
    existingRecipe: GenerateRecipeResponseDto,
    instruction: string,
    dietaryRestrictions?: string[]
) => {
    const ingredientsList = existingRecipe.ingredients
        .map((ing) => `${ing.quantity}${ing.unit} ${ing.name}`)
        .join("\n");

    const instructionsList = existingRecipe.instructions
        .map((inst, idx) => `${idx + 1}. ${inst.text}`)
        .join("\n");

    const nutritionInfo = `Calories: ${existingRecipe.kcal}kcal, Carbs: ${existingRecipe.carbs}g, Protein: ${existingRecipe.protein}g, Fat: ${existingRecipe.fat}g`;

    const dietaryLine = dietaryRestrictions?.length
        ? `\nDietary restrictions to respect: ${dietaryRestrictions.join(", ")}`
        : "";

    return `Modification requested: "${instruction}"
${dietaryLine}

Apply it to this recipe:

Recipe Name: ${existingRecipe.name}
Description: ${existingRecipe.description}
Difficulty: ${existingRecipe.difficulty}
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
- Keep difficulty "${existingRecipe.difficulty}" unchanged
- Keep tags unchanged: ${existingRecipe.tags.join(", ")}
- Only change what the modification requires; leave everything else intact`;
};

/**
 * Derive a short, human-readable label for the variant from the raw
 * instruction, e.g. "make it vegetarian" -> "Vegetarian". Best-effort only —
 * the user can rename it when saving.
 */
const deriveLabel = (instruction: string): string => {
    const cleaned = instruction
        .trim()
        .replace(/^(please\s+)?(can you\s+)?(make (it|this)|turn (it|this) into|convert (it|this) to)\s+/i, "")
        .trim();
    const label = cleaned.length > 0 ? cleaned : instruction.trim();
    const capped = label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label;
    return capped.charAt(0).toUpperCase() + capped.slice(1);
};

export const modifyRecipe = createStreamHandler({
    requestSchema: ModifyRecipeRequestSchema,
    responseSchema: [
        HeaderSchema,
        NutritionSchema,
        IngredientSchema,
        InstructionSchema,
        TipSchema,
    ],

    handler: async ({ body }) => {
        // 1. Fetch existing recipe
        const existingRecipe = await fetchRecipe(body.id);

        if (!existingRecipe) {
            throw new Error(`Recipe not found: ${body.id}`);
        }

        // Reuse the source recipe's image — a variation of the same dish looks
        // the same, so we skip the slow/costly image generation.
        const existingImageUrl = (existingRecipe as { imageUrl?: string })
            .imageUrl;

        const label = deriveLabel(body.instruction);

        // 2. Fetch metadata for the prompt
        const metadata = await fetchRecipeMetadata();
        const unitsPrompt = formatUnitsForPrompt(metadata.units);
        const tagsPrompt = formatTagsForPrompt(metadata.tags);

        // 3. Call the model
        const stream = generateStream({
            model: { openai: "gpt-4.1" },
            system: buildSystemPrompt(unitsPrompt, tagsPrompt),
            user: buildUserPrompt(
                existingRecipe,
                body.instruction,
                body.dietaryRestrictions
            ),
        });

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
                difficulty: existingRecipe.difficulty, // unchanged for a modification
                servings: existingRecipe.servings,
                tags: existingRecipe.tags, // MUST remain constant
            },
        });

        // 4. Wrap the recipe stream so we can persist the finished variant and
        //    return its new id. The client's done-detector fires on the
        //    `complete` frame, so we must fold the persisted id + label INTO that
        //    terminal frame — the recipe stream's own `complete` carries an empty
        //    id (it's persisted out-of-band), so we hold it back and re-emit a
        //    `complete` once the row exists. (The generic handler's onComplete
        //    hook runs only after the connection closes, so it can't do this.)
        async function* streamWithPersist() {
            let finalRecipe: GenerateRecipeResponseDto | undefined;

            for await (const frame of recipeStream) {
                if (
                    frame &&
                    typeof frame === "object" &&
                    (frame as { type?: string }).type === "complete"
                ) {
                    finalRecipe = (frame as { recipe: GenerateRecipeResponseDto })
                        .recipe;
                    // Suppress the id-less completion; re-emitted below with the id.
                    continue;
                }
                yield frame;
            }

            if (!finalRecipe) {
                yield { type: "complete", saved: false };
                return;
            }

            // Tag the lineage in the INSERT itself. The variant keeps the base's
            // name, so an untagged row shows up in search as an indistinguishable
            // duplicate — that has to be true from the moment it exists, not from
            // when the user saves it, and not one statement later either: the
            // partial unique index treats a momentarily-unparented variant as a
            // duplicate base recipe and rejects the insert.
            const base = await new RecipesRepository().resolveVariantBase(
                body.id
            );

            if (!base.success) {
                console.error(
                    "Failed to resolve the modified recipe's base:",
                    base.error.message
                );
            }

            const persistResult = await persistRecipe(
                finalRecipe,
                existingImageUrl,
                base.success ? base.value : null
            );

            if (persistResult.success) {
                yield {
                    type: "complete",
                    saved: true,
                    id: persistResult.value,
                    label,
                    recipe: finalRecipe,
                };
            } else {
                console.error(
                    "Failed to persist modified recipe:",
                    persistResult.error.message
                );
                // Still emit a terminal frame so the client stops streaming.
                yield { type: "complete", saved: false };
            }
        }

        return {
            type: "stream" as const,
            stream: streamWithPersist(),
        };
    },
});
