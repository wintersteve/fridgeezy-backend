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
    /**
     * Which candidate the name resolved to — an index into the shortlist that
     * was offered. Populated only when decision is "same".
     */
    matchIndex?: number;
    /** Controlled food category — populated only when decision is "new". */
    category?: IngredientCategory;
}

const CATEGORY_RULE = `the single best-fitting food category. Return EXACTLY one of these ids (the id itself, not the description):
${CATEGORY_GUIDE}`;

/**
 * Asked when near-miss candidates exist: is NAME any of them?
 *
 * The shortlist form is the fix, not a refactor. This used to be handed exactly
 * ONE candidate — whichever ranked first by embedding — and asked a yes/no
 * question about it. Because name embeddings are lexical, rank 1 is
 * systematically a SIBLING (shares the head noun) while the synonym sits
 * further down, so the model was reliably asked about the wrong ingredient,
 * correctly answered "not the same", and a duplicate was created. It answered
 * well every time; it was never shown the right pair.
 */
const DEDUP_SYSTEM_PROMPT = `You classify ingredient names for a cooking database.

Given an ingredient NAME and a numbered list of CANDIDATE existing ingredients, decide whether NAME is one of them, and if not, give the new ingredient a category.

decision:
- "same": NAME is the same ingredient as one candidate — a synonym, regional name, or spelling variant (e.g. "spring onion" vs "scallion", "cilantro" vs "coriander", "minced pork" vs "ground pork"). Set "match" to that candidate's number.
- "new": NAME is a real, distinct culinary ingredient, different from EVERY candidate.

Default to "new". Only answer "same" when NAME and the candidate are DIFFERENT WORDS FOR THE SAME THING — a regional name, a spelling variant, or a translation. "spring onion" is "scallion"; "cilantro" is "coriander"; "crayfish" is "crawfish"; "minced pork" is "ground pork"; "aubergine" is "eggplant".

If the two names differ by a QUALIFIER rather than by vocabulary, answer "new". This holds even when the qualified thing is obviously a kind of the other, and even when one name contains the other:
- "whole wheat flour" is NOT "flour". "rice flour" is NOT "flour".
- "iceberg lettuce" is NOT "lettuce". "kewpie mayonnaise" is NOT "mayonnaise".
- "back bacon" is NOT "bacon". "green olives" is NOT "olives".
- "thai basil" is NOT "basil". "duck egg" is NOT "egg". "brown sugar" is NOT "sugar".
- "dried oregano" is NOT "fresh oregano". "firm tofu" is NOT "tofu".

Do not reason about which one is the "default" or "everyday" form — that judgement is made elsewhere, from a curated alias list, and making it here produces exactly the wrong merges. A narrower ingredient swallowed by a broader one silently corrupts every recipe using it.

Ignore pure preparation words (chopped, minced, sliced, grated) — those do not by themselves make it distinct, so "chopped parsley" IS "parsley".

NAME is always a real ingredient. You are not being asked to validate it, only to decide whether it is one of the candidates.

category (only when decision is "new"): ${CATEGORY_RULE}

Respond with a single JSON object and nothing else:
{"decision":"same"|"new","match":<candidate number or null>,"category":"<one id from the list above, or null>"}.`;

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
    candidateNames: string[] = []
): Promise<IngredientAdjudication> {
    const hasCandidates = candidateNames.length > 0;

    try {
        const { text: content } = await generateCompletion({
            model: { openai: "gpt-4o-mini" },
            label: "adjudicate.ingredient",
            system: hasCandidates
                ? DEDUP_SYSTEM_PROMPT
                : CATEGORY_SYSTEM_PROMPT,
            user: hasCandidates
                ? `NAME: ${name}\nCANDIDATES:\n${candidateNames
                      .map((candidate, i) => `${i + 1}. ${candidate}`)
                      .join("\n")}`
                : `NAME: ${name}`,
            json: true,
            // 40 covers `{"decision":"same","match":3,"category":null}` on a
            // model that answers immediately — up from 30, since the verdict now
            // carries the candidate number. The Bedrock number has to clear the
            // thinking budget first, which is why it isn't a conversion of it.
            maxTokens: { openai: 40, bedrock: 1024 },
            // Picking one of a fixed 20-item vocabulary — the shallowest
            // judgement of the three adjudicators.
            effort: "low",
        });

        if (!content) return { decision: "new" };

        const parsed = JSON.parse(content) as {
            decision?: string;
            match?: number | null;
            category?: string;
        };

        // "same" is only meaningful against an actual candidate, and only when
        // the model names one that was actually offered. A match number outside
        // the shortlist is treated as "new": inventing an index is the one
        // failure here that would silently attach an ingredient to an unrelated
        // row, and creating a duplicate is the recoverable direction.
        if (parsed.decision === "same" && hasCandidates) {
            const index = Number(parsed.match) - 1;
            if (Number.isInteger(index) && index >= 0 && index < candidateNames.length) {
                return { decision: "same", matchIndex: index };
            }
            console.warn(
                `[Ingredients] "${name}" adjudicated "same" with out-of-range match ${parsed.match} — creating instead`
            );
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
