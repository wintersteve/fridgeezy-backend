import { openai } from "@fridgeezy/openai";

export type IngredientDecision = "same" | "new" | "invalid";

/** Controlled food-category vocabulary (mirrors the camera/recipe extraction set). */
export const INGREDIENT_CATEGORIES = [
    "meat",
    "poultry",
    "seafood",
    "dairy",
    "vegetable",
    "fruit",
    "grain",
    "legume",
    "herb",
    "spice",
    "oil",
    "condiment",
    "nut",
    "seed",
    "sweetener",
    "beverage",
    "other",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export interface IngredientAdjudication {
    decision: IngredientDecision;
    /** Controlled food category — populated only when decision is "new". */
    category?: IngredientCategory;
}

const SYSTEM_PROMPT = `You validate ingredient names for a cooking database.

Given an ingredient NAME and optionally a CANDIDATE existing ingredient, respond with a decision and (for new ingredients) a category.

decision:
- "same": NAME is the same ingredient as CANDIDATE — a synonym, regional name, or spelling variant (e.g. "spring onion" vs "scallion"). Only valid when a CANDIDATE is provided.
- "invalid": NAME is not a usable culinary ingredient — gibberish, a dish or recipe name, a hallucination, or an unusable fragment.
- "new": NAME is a real, distinct culinary ingredient (different from CANDIDATE, or there is no candidate).

category (only when decision is "new"): the single best-fitting food category, chosen from EXACTLY this list:
${INGREDIENT_CATEGORIES.join(", ")}.

Respond with a single JSON object and nothing else:
{"decision":"same"|"new"|"invalid","category":"<one of the list, or null>"}.`;

/**
 * Ingredient creation gate: decide whether an unmatched ingredient name is the
 * same as a near-miss candidate, a genuinely new ingredient (with a controlled
 * category), or not a real ingredient at all. Fails open to a category-less
 * "new" on any error so an LLM hiccup never silently drops a valid ingredient.
 */
export async function adjudicateIngredient(
    name: string,
    candidateName?: string
): Promise<IngredientAdjudication> {
    const userPrompt = candidateName
        ? `NAME: ${name}\nCANDIDATE: ${candidateName}`
        : `NAME: ${name}\nCANDIDATE: (none)`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 30,
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return { decision: "new" };

        const parsed = JSON.parse(content) as {
            decision?: string;
            category?: string;
        };

        // "same" is only meaningful against an actual candidate.
        if (parsed.decision === "same" && candidateName) {
            return { decision: "same" };
        }
        if (parsed.decision === "invalid") {
            return { decision: "invalid" };
        }

        // "new" (default): keep the category only if it's in the controlled list.
        const category = INGREDIENT_CATEGORIES.includes(
            parsed.category as IngredientCategory
        )
            ? (parsed.category as IngredientCategory)
            : undefined;
        return { decision: "new", category };
    } catch (error) {
        console.error(
            `[Ingredients] Adjudication failed for "${name}" — defaulting to create:`,
            error
        );
        return { decision: "new" };
    }
}
