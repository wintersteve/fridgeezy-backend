import { generateCompletion } from "@fridgeezy/llm";

export type IngredientDecision = "same" | "new";

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

const CATEGORY_RULE = `the single best-fitting food category. Return EXACTLY one of these ids (the id itself, not the description):
${CATEGORY_GUIDE}`;

/** Asked when a near-miss candidate exists: is NAME the same thing as CANDIDATE? */
const DEDUP_SYSTEM_PROMPT = `You classify ingredient names for a cooking database.

Given an ingredient NAME and a CANDIDATE existing ingredient, respond with a decision and (for new ingredients) a category.

decision:
- "same": NAME is the same ingredient as CANDIDATE — a synonym, regional name, or spelling variant (e.g. "spring onion" vs "scallion").
- "new": NAME is a real, distinct culinary ingredient, different from CANDIDATE.

A qualifier that changes VARIETY/TYPE (e.g. "Thai basil" vs "basil", "cherry tomato" vs "tomato") or STATE (e.g. "dried oregano" vs "fresh oregano" vs "oregano", "frozen peas" vs "peas") makes NAME a DISTINCT ingredient → "new", NOT "same", even though it is closely related to CANDIDATE. Only rule "same" for a true synonym of the identical item. Ignore pure preparation words (chopped, minced, sliced) — those do not by themselves make it distinct.

NAME is always a real ingredient. You are not being asked to validate it, only to decide whether it is the same thing as CANDIDATE.

category (only when decision is "new"): ${CATEGORY_RULE}

Respond with a single JSON object and nothing else:
{"decision":"same"|"new","category":"<one id from the list above, or null>"}.`;

/**
 * Asked when there is no candidate at all. "same" is impossible, so the only
 * open question is which category the new row gets — and that answer is worth a
 * call, because the embedding-centroid fallback it replaces guesses badly on
 * exactly these (a "port wine" lands as easily in sauces as in beverages).
 */
const CATEGORY_SYSTEM_PROMPT = `You categorise ingredient names for a cooking database.

Given an ingredient NAME, return ${CATEGORY_RULE}

Respond with a single JSON object and nothing else:
{"category":"<one id from the list above>"}.`;

/**
 * Ingredient creation gate: decide whether an unmatched ingredient name is the
 * same as a near-miss candidate or a genuinely new ingredient, and pick the
 * controlled category a new one is created under. Fails open to a category-less
 * "new" on any error so an LLM hiccup never costs an ingredient.
 *
 * **There is deliberately no "invalid" verdict.** This used to be able to rule a
 * name junk, and `matchIngredients` dropped those — which is how a real
 * "evaporated milk" vanished out of a Suspiro de Limeña. The asymmetry is
 * one-sided and the drop was on the wrong side of it:
 *
 * - A junk row costs one bad catalog entry, reversible with `merge_ingredient`.
 * - A dropped real ingredient is not reversible. `recipe_suggestions` stores
 *   only ids, so the model's own name list is gone. Worse, the diets in
 *   `recipe_suggestion_dietary` are a NEGATIVE proof — "no ingredient here is
 *   disqualifying" — so losing the dairy makes a dairy dessert display as
 *   `dairy_free`. And promotion then constrains the recipe to the survivors; if
 *   the model reintroduces the missing ingredient anyway (it will, for a dish
 *   defined by it) it arrives with no id and `persist_recipe_with_ingredient_ids`
 *   raises.
 *
 * A destructive verdict also had no business being asked of gpt-4o-mini at
 * `effort: "low"` inside a 30-token budget. Junk is kept out upstream instead,
 * by the generator prompt and the authenticity gate.
 */
export async function adjudicateIngredient(
    name: string,
    candidateName?: string
): Promise<IngredientAdjudication> {
    try {
        const { text: content } = await generateCompletion({
            model: { openai: "gpt-4o-mini" },
            label: "adjudicate.ingredient",
            system: candidateName
                ? DEDUP_SYSTEM_PROMPT
                : CATEGORY_SYSTEM_PROMPT,
            user: candidateName
                ? `NAME: ${name}\nCANDIDATE: ${candidateName}`
                : `NAME: ${name}`,
            json: true,
            // 30 covers `{"decision":"same","category":"vegetables"}` on a model
            // that answers immediately; the Bedrock number has to clear the
            // thinking budget first, which is why it isn't a conversion of it.
            maxTokens: { openai: 30, bedrock: 1024 },
            // Picking one of a fixed 20-item vocabulary — the shallowest
            // judgement of the three adjudicators.
            effort: "low",
        });

        if (!content) return { decision: "new" };

        const parsed = JSON.parse(content) as {
            decision?: string;
            category?: string;
        };

        // "same" is only meaningful against an actual candidate.
        if (parsed.decision === "same" && candidateName) {
            return { decision: "same" };
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
