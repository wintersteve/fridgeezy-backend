/**
 * Conservative singularizer for ONE canonical token.
 *
 * Mirrors the Postgres `singularize_token(text)` function exactly. The pair is
 * load-bearing: `ingredients.canonical_id` is produced by the SQL side, and the
 * app computes the same value in JS to look rows up. If the two ever disagree,
 * lookups miss and duplicate ingredients get created — silently, because a miss
 * looks identical to "not seen before".
 */
export const singularizeToken = (tok: string): string => {
    if (tok.length <= 3) return tok;
    // berries -> berry, cherries -> cherry
    if (/ies$/.test(tok) && tok.length > 4) return tok.slice(0, -3) + "y";
    // tomatoes -> tomato, boxes -> box, dishes -> dish, peaches -> peach
    if (/(oes|ses|xes|zes|ches|shes)$/.test(tok)) return tok.slice(0, -2);
    // apples -> apple, olives -> olive; but NOT ss/us/is (glass, asparagus, basis)
    if (/s$/.test(tok) && !/(ss|us|is)$/.test(tok)) return tok.slice(0, -1);
    return tok;
};

/**
 * The identity rule for an INGREDIENT name: the canonical slug with its last
 * token singularized, so "green apples" and "green apple" are one ingredient.
 * The last token is the head noun in English.
 *
 * Mirrors the Postgres `ingredient_canonical_id(text)` function.
 *
 * Note this is NOT the same rule as {@link canonicalizeName}: this one trims
 * edge underscores *and* singularizes. Three distinct rules exist in this
 * schema — see `canonicalizeName` for the non-singularizing one, and
 * `sqlCanonicalId` in the recipes repository for the untrimmed one that matches
 * a generated column. They are not interchangeable.
 */
export const ingredientCanonicalId = (name: string): string => {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!base) return base;

    const parts = base.split("_");
    parts[parts.length - 1] = singularizeToken(parts[parts.length - 1]);
    return parts.join("_");
};
