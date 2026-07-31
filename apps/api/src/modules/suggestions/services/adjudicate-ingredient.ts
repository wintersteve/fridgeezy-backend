import { openai } from "@fridgeezy/openai";

export type IngredientDecision = "same" | "new" | "invalid";

/**
 * Controlled food-category vocabulary — the canonical_ids of the seeded
 * `categories` table (see seeds/004_categories.sql). The adjudicator MUST pick
 * from these exact ids so the value resolves directly via
 * CategoriesRepository.findByCanonicalId (no transform). Previously this was a
 * different, singular 17-item set that never matched the DB, so every adjudicated
 * category silently fell back to the embedding-centroid guess.
 */
export const INGREDIENT_CATEGORIES = [
    "meats",
    "seafood",
    "eggs",
    "dairy",
    "vegetables",
    "fruits",
    "grains",
    "legumes",
    "nuts_seeds",
    "herbs_spices",
    "mushrooms",
    "noodles",
    "breads",
    "fats_oils",
    "sweeteners",
    "stocks",
    "sauces",
    "vinegars",
    "beverages",
    "baking",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

/** Human glosses for each category id, to steer the LLM's pick. */
const CATEGORY_GUIDE = `- meats: red meat, poultry, game
- seafood: fish, shellfish, crustaceans
- eggs: eggs of any bird
- dairy: milk, cream, yogurt, butter, cheese
- vegetables: all vegetables including roots and greens
- fruits: fresh and dried fruit, berries
- grains: rice, quinoa, oats, wheat, barley, couscous
- legumes: beans, lentils, peas, chickpeas
- nuts_seeds: tree nuts, peanuts, seeds
- herbs_spices: fresh/dried herbs, spices, seasonings
- mushrooms: all fungi
- noodles: pasta and Asian noodles
- breads: bread, tortillas, pita, wraps, crackers
- fats_oils: cooking oils and solid fats
- sweeteners: sugar, honey, maple syrup, agave
- stocks: broths, stocks, bouillon
- sauces: sauces, condiments, dressings
- vinegars: all vinegars
- beverages: alcoholic and non-alcoholic drinks
- baking: baking powder/soda, yeast, flour, extracts`;

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

A qualifier that changes VARIETY/TYPE (e.g. "Thai basil" vs "basil", "cherry tomato" vs "tomato") or STATE (e.g. "dried oregano" vs "fresh oregano" vs "oregano", "frozen peas" vs "peas") makes NAME a DISTINCT ingredient → "new", NOT "same", even though it is closely related to CANDIDATE. Only rule "same" for a true synonym of the identical item. Ignore pure preparation words (chopped, minced, sliced) — those do not by themselves make it distinct.

category (only when decision is "new"): the single best-fitting food category. Return EXACTLY one of these ids (the id itself, not the description):
${CATEGORY_GUIDE}

Respond with a single JSON object and nothing else:
{"decision":"same"|"new"|"invalid","category":"<one id from the list above, or null>"}.`;

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
