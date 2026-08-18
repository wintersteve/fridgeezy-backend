import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";

import { HEADER_DESCRIPTION_RULES } from "./description-rules";
import { STEP_DURATION_RULES, TEMPERATURE_RULES } from "./instruction-rules";

/**
 * The "rewrite this recipe, keep it the same dish" prompt.
 *
 * Lifted out of `modify-recipe.ts` when a second caller appeared: promotion now
 * has to adapt a catalogue recipe around the caller's blacklist, and that is the
 * same operation with the instruction written for it. Two copies of a prompt
 * this specific is how the recipe hero and the cuisine tiles drifted apart (see
 * `buildFoodIllustrationStyle` in libs/genai) — the copies stay identical right
 * up until one of them is improved.
 *
 * Nothing here changed in the move. The system half is a pure function of the
 * unit and tag vocabularies, so it is the cacheable prefix; everything
 * per-request lives in the user half.
 */
export const buildModifySystemPrompt = (
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

${TEMPERATURE_RULES}

${STEP_DURATION_RULES}

## Output Format (JSONL - one JSON object per line)
Output the recipe as multiple JSON lines in this exact order:

Line 1 - Header with basic info:
{"type":"header","description":"One sentence saying what the dish is","shortDescription":"Short card gloss","prepTime":15,"cookTime":30}
${HEADER_DESCRIPTION_RULES}


Line 2 - Nutrition information (per serving):
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

export const buildModifyUserPrompt = (
    existingRecipe: GenerateRecipeResponseDto,
    instruction: string,
    dietaryRestrictions?: string[]
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
