import { ingredientCanonicalId } from "../ingredient-canonical-id";

/**
 * How two ingredient names relate STRUCTURALLY — by their words, before anyone
 * asks what they mean.
 *
 * This exists because cosine similarity provably cannot separate a duplicate
 * from a sibling in this catalogue. Measured on live data:
 *
 *     0.619  Flour <-> All Purpose Flour   must MERGE
 *     0.625  Flour <-> Rice Flour          must stay DISTINCT
 *
 * The pair that must stay apart scores HIGHER. Any threshold that merges the
 * first merges the second, and "Rice Flour is Flour" is the silent, destructive
 * failure — it corrupts recipes and nothing reports it. So similarity is used
 * only to RETRIEVE candidates; it never decides.
 *
 * The decision axis is the head noun (the last canonical token, already
 * singularised) against the modifiers in front of it.
 */
export type IngredientRelation =
    /**
     * Same head noun, and BOTH sides carry modifiers — "green onion" vs
     * "white onion", "chicken egg" vs "duck egg", "rice flour" vs
     * "all purpose flour". A contrast drawn WITHIN a kind: variety, colour,
     * animal, grain. Presumed DISTINCT and never auto-merged.
     */
    | "sibling"
    /**
     * Same head noun, one side bare — "flour" vs "rice flour", "egg" vs
     * "chicken egg". Genuinely ambiguous: the modifier either names the default
     * kind (merge) or a specific one (keep). Has to be asked.
     */
    | "bare_vs_modified"
    /**
     * Different head nouns — "scallion" vs "green onion", "cilantro" vs
     * "coriander", "parmesan" vs "parmesan cheese". The synonym shape, and also
     * the unrelated shape. Has to be asked.
     */
    | "different_head";

export interface IngredientNameParts {
    canonicalId: string;
    /** Last canonical token — the head noun in English, already singularised. */
    head: string;
    /** Everything in front of the head, in canonical form. */
    modifiers: string[];
}

/**
 * Splits a name into head noun + modifiers, using the same canonical rule the
 * database stores. "Cherry Tomatoes" -> head `tomato`, modifiers `["cherry"]`.
 */
export const ingredientNameParts = (name: string): IngredientNameParts => {
    const canonicalId = ingredientCanonicalId(name);
    const parts = canonicalId.split("_").filter(Boolean);

    if (parts.length === 0) {
        return { canonicalId, head: "", modifiers: [] };
    }

    return {
        canonicalId,
        head: parts[parts.length - 1],
        modifiers: parts.slice(0, -1),
    };
};

/**
 * Classifies the relationship between two ingredient names.
 *
 * Note what this deliberately does NOT claim: that a `sibling` verdict means
 * the two are different things. "Green Onion" vs "Spring Onion" is structurally
 * identical to "Chicken Egg" vs "Duck Egg" — same head, both modified — and the
 * first pair is one ingredient while the second is two. No rule over the
 * strings can tell them apart; it takes world knowledge.
 *
 * So `sibling` sets the DEFAULT (presume distinct) and the burden of proof. The
 * cases it gets wrong surface as review rows rather than as silent merges,
 * which is the direction that is recoverable.
 */
export const ingredientRelation = (
    a: string,
    b: string
): IngredientRelation => {
    const pa = ingredientNameParts(a);
    const pb = ingredientNameParts(b);

    if (pa.head !== pb.head) return "different_head";
    if (pa.modifiers.length > 0 && pb.modifiers.length > 0) return "sibling";
    return "bare_vs_modified";
};

/**
 * Whether a candidate may be offered to the adjudicator at all.
 *
 * Two things are withheld, for two different reasons.
 *
 * **Siblings**, because asking about them is what creates the opportunity to
 * merge "Rice Flour" into "Flour". Widening retrieval from one candidate to ten
 * is only an improvement with this filter in front of it — without it, the wider
 * net simply surfaces more siblings, which is the failure mode being designed
 * against rather than a new capability.
 *
 * **Candidates MORE SPECIFIC than the name**, because that direction is always
 * wrong and the model reliably gets it wrong when left to judge. Measured over
 * the whole catalogue, gpt-4o-mini merged "Mayonnaise" into "Kewpie
 * Mayonnaise", "Tempeh" into "Smoked Tempeh" and "Vermicelli" into "Rice
 * Vermicelli" — each of which takes a general ingredient and files it under one
 * brand or variety, so every later recipe calling for plain mayonnaise gets the
 * Japanese one.
 *
 * The asymmetry is the point: resolving a NARROW name onto a BROAD row can be
 * right ("all purpose flour" really is "flour"), and is decided by the curated
 * alias list. Resolving BROAD onto NARROW never is, so it does not need
 * judgement — it needs refusing.
 */
export const isAdjudicableCandidate = (
    name: string,
    candidateName: string
): boolean => {
    const parts = ingredientNameParts(name);
    const candidate = ingredientNameParts(candidateName);

    if (parts.head !== candidate.head) return true;
    if (parts.modifiers.length > 0 && candidate.modifiers.length > 0) {
        return false; // sibling
    }
    // Same head, one side bare: allow only narrow -> broad.
    return parts.modifiers.length > candidate.modifiers.length;
};
