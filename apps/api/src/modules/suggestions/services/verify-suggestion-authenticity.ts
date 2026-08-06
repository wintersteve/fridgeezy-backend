import { generateCompletion } from "@fridgeezy/llm";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";

import { DISH_NAME_ALT_RULE, DISH_NAME_RULE } from "./naming-rules";
import { describeSuggestion } from "./suggestion-signature";

export type AuthenticityStatus =
    | "canonical"
    | "regional_variant"
    /**
     * A real dish with a DEFINING ingredient removed or swapped — a ceviche with
     * no seafood, a carbonara with no egg. Distinct from "invention" because the
     * named dish is real; what was submitted is not it.
     */
    | "adaptation"
    /**
     * A real, well-attested *thing to consume* that is not FOOD — a drink.
     *
     * Orthogonal to every other status here, which is why it needs its own: a
     * Mojito is impeccably canonical and would score as such. This app's scope is
     * food, and the tag taxonomy encodes that assumption without enforcing it —
     * `course` is exactly {appetizer, main, side, dessert} and no `dish_form` is
     * a drink, so a beverage that gets past this gate is not merely off-scope,
     * it is stored MISLABELLED and then feeds `listCatalogDishes` and the
     * signature embeddings as if it were a dish.
     */
    | "not_food"
    | "modern_fusion"
    | "invention"
    | "unknown";

export interface AuthenticityVerdict {
    status: AuthenticityStatus;
    confidence: number;
    /**
     * What the dish should be CALLED, by the same rule the generator was given.
     * Usually the proposed name echoed back; a correction when the generator
     * reached for a native name English sources don't use.
     */
    name?: string;
    nameAlt?: string | null;
}

/** The verdict as callers act on it: does this dish go in, and under what name? */
export interface SuggestionReview {
    authentic: boolean;
    /**
     * Why, for the drop log. "adaptation" and "invention" are very different
     * problems — one means the generator gutted a real dish to satisfy a
     * restriction, the other means it made one up — and a log line reading
     * "not attested" for both makes the first invisible.
     */
    status: AuthenticityStatus;
    /** Set only when the name should CHANGE — absent means keep what was proposed. */
    name?: string;
    nameAlt?: string | null;
}

/** Minimum confidence for an attested verdict to be trusted. */
const CONFIDENCE_FLOOR = 0.6;
/** Statuses allowed into the discovery catalog. */
const ATTESTED: AuthenticityStatus[] = ["canonical", "regional_variant"];

const STATUSES: AuthenticityStatus[] = [
    "canonical",
    "regional_variant",
    "adaptation",
    "not_food",
    "modern_fusion",
    "invention",
    "unknown",
];

/**
 * Naming is folded into the authenticity check rather than given its own call.
 *
 * The two judgements want exactly the same evidence — is this a real dish, and
 * what do people actually call it — and this call already runs once per new
 * dish, in parallel with dedup, so the naming pass is free. A separate call
 * before the provisional card would have added its full latency to every card.
 *
 * The generator's own naming rule was not enough on its own: it already asked
 * for "the name an English-speaking home cook would most commonly recognise" and
 * still produced *Pain Aux Bananes* for banana bread. This is a second, single-
 * purpose look at one dish, with the rule quoted verbatim so the two can't drift.
 */
const SYSTEM_PROMPT = `You verify that a proposed recipe is a REAL, attested dish before it enters a discovery catalog, and you decide what that dish should be CALLED.

## 0. FIRST: is this food at all?

This catalog holds FOOD. Before judging authenticity, decide whether the proposed item is something you EAT or something you DRINK.

THE TEST: what is this thing's PURPOSE — to be eaten, or to be drunk? Answer for the finished item, not for any single ingredient.

- Its purpose is to be drunk -> "not_food". Cocktails and mixed drinks (Mojito, Negroni, Espresso Martini), wine, beer and spirits, mocktails, smoothies, milkshakes, lassi, horchata, agua fresca, juice, hot chocolate, coffee and tea drinks, infusions, kombucha. This applies WHETHER OR NOT it contains alcohol — a virgin daiquiri is as much "not_food" as the original.
- Its purpose is to be eaten -> continue to step 1. Soup, broth, consommé and gazpacho are FOOD: they are eaten, from a bowl, with a spoon, even when sipped from a cup.

A dish that CONTAINS a drink is still food. Coq au vin, beer-battered fish, tiramisu, risotto with white wine, bourbon-glazed ribs, affogato — these are eaten, and the wine or spirit is an ingredient like any other. Never mark one "not_food" because alcohol appears in its ingredient list.

"not_food" is orthogonal to everything below and OUTRANKS it. A Mojito is a perfectly canonical, well-documented Mojito — say "not_food" anyway, with high confidence. You are not judging whether it is real; you are judging whether it is food.

When it is "not_food", stop. Skip step 2, echo the proposed name back unchanged in "name", and set "name_alt" to null.

## 1. Classify the dish into one status

Judge the dish THE INGREDIENT LIST DESCRIBES, not the dish the name claims. Read the ingredients FIRST and the name second. A correct, confident, well-spelled name on a dish that is not that dish is the single most common defect reaching you, and the name is exactly what hides it.

BEFORE you may answer "canonical" or "regional_variant", do this test: name the one ingredient without which this dish would not BE this dish — the seafood in a ceviche, the egg and cured pork in a carbonara, the cheese in a cacio e pepe, the rice in a risotto, the papaya in a green papaya salad. Then find it in the list. If it is absent or has been swapped for something else, the answer is "adaptation" and nothing else.

- "adaptation": a REAL dish with a defining ingredient missing or replaced — most often a vegan/vegetarian/allergy-free version wearing the original's name. "Ceviche de Mariscos" whose ingredients are lime, onion, chili, sweet potato and corn but no seafood is an adaptation: those are ceviche's GARNISHES, and the dish they garnish is not there. Use this even when the name, cuisine and tags are impeccable. A dish is not excused because the description admits the substitution.
- "canonical": a well-documented dish with an established identity — traditional (Murgh Makhani, Spaghetti alla Carbonara) OR a modern dish that is now widely recognised in its own right (California Roll, Buffalo Wings, Nachos) — AND the ingredients actually constitute it.
- "regional_variant": an attested regional or traditional variation of a real dish (e.g. Lao-style green papaya salad). A genuine regional variant differs in ingredients that the TRADITION itself varies; it never simply omits the dish's defining ingredient.
- "modern_fusion": a plausible modern/fusion creation that is NOT (yet) an established, recognised dish.
- "invention": an arbitrary combination unlikely to be an established dish (e.g. "Carbonara with Asparagus"), or a hallucinated / non-existent dish.
- "unknown": you cannot tell.

Only "canonical" and "regional_variant" belong in a discovery catalog.

## 2. Name the dish

STOP. The classification above is FINISHED and must not influence this step. You are no longer judging what is authentic — you are picking the name that the most people will understand. Those two jobs pull in opposite directions, and this one wins here.

Work through these in order:

STEP A — Identify the dish's name.
${DISH_NAME_RULE}

STEP B — Check the DIRECTION of any change you are about to make. Corrections only ever run ONE way: toward the name an English speaker understands.
  - Proposed name is plain English and the dish is real -> KEEP IT. Never swap plain English back to the native name because the native one is more "authentic": "Scattered Sushi" does NOT become "Chirashi Sushi", "Savoury Cabbage Pancake" does NOT become "Okonomiyaki", "Butter Chicken" does NOT become "Murgh Makhani".
  - Proposed name is native and fails the test in Step A -> translate it.
  - If your new name is HARDER for an English speaker than the proposed one, you have gone the wrong way. Revert to the proposed name.

STEP C — Strip any qualifier that adds nothing, on whichever name survived Step B. "Cucumber Sunomono" -> "Sunomono"; "Apple Tarte Tatin" -> "Tarte Tatin". Keep a qualifier ONLY when it marks a genuinely different dish ("Hiroshima-style Okonomiyaki"). A base dish and a redundantly-qualified one are stored as two rows and shown to the user as the same dish twice, which is the single most common defect this step exists to prevent.

${DISH_NAME_ALT_RULE}

Echo the proposed name back unchanged unless it clearly breaks Step A or Step C. Renaming a dish that was already right is worse than leaving it alone.

Respond with a single JSON object and nothing else:
{"status":"canonical"|"regional_variant"|"adaptation"|"not_food"|"modern_fusion"|"invention"|"unknown","confidence":0.0-1.0,"name":"...","name_alt":"..."|null}.`;

/**
 * Raw classification (status + confidence + the name it should carry). Throws on
 * API error — the gate below handles that as fail-open. Exposed so the
 * calibration eval can inspect the distribution.
 */
export async function classifySuggestionAuthenticity(
    suggestion: GenerateSuggestionResponseDto
): Promise<AuthenticityVerdict> {
    const { text: content } = await generateCompletion({
        // gpt-4o, not the -mini this used while it only classified authenticity.
        // Naming is a judgement at the margin — is "Rendang" met in English on
        // its own? — and mini was inconsistent on exactly that tail: it renamed
        // "Klepon" on one run and kept it on the next, and once corrected
        // "Savoury Cabbage Pancake" BACK to "Okonomiyaki". One call per NEW dish
        // (dedup returns before this for anything already in the catalog), so
        // the cost is bounded by how many genuinely new dishes are generated.
        model: { openai: "gpt-4o" },
        label: "authenticity.verify",
        system: SYSTEM_PROMPT,
        user: describeSuggestion(
            suggestion.name,
            suggestion.name_alt,
            suggestion.tags,
            suggestion.ingredients
        ),
        json: true,
        // Was 20, when the verdict was two fields. A truncated response is
        // unparseable JSON, which fails open and silently stops correcting names.
        //
        // The Bedrock number is the most generous of the three adjudicators, and
        // deliberately so: this gate fails OPEN, so a cap that truncates doesn't
        // degrade the verdict, it removes the gate — inventions and gutted
        // dishes go straight into the catalog with nothing logged. 80 tokens of
        // verdict is not what the budget is for; clearing the thinking allowance
        // on the hardest judgement in the pipeline is.
        maxTokens: { openai: 80, bedrock: 2048 },
        // Effort is left at the default (medium) rather than lowered with the
        // other two. This is the call that has to notice a ceviche with no
        // seafood — `GUTTED_DISHES` in dedup-authenticity.eval.ts is that exact
        // row — and it is the one adjudicator whose accuracy the eval gate reads.
    });

    if (!content) return { status: "unknown", confidence: 0 };

    const parsed = JSON.parse(content) as {
        status?: string;
        confidence?: number;
        name?: string;
        name_alt?: string | null;
    };
    const status = STATUSES.includes(parsed.status as AuthenticityStatus)
        ? (parsed.status as AuthenticityStatus)
        : "unknown";

    return {
        status,
        confidence: parsed.confidence ?? 0,
        name: typeof parsed.name === "string" ? parsed.name.trim() : undefined,
        nameAlt: typeof parsed.name_alt === "string" ? parsed.name_alt.trim() : null,
    };
}

/**
 * Authenticity gate + canonical name: is this an attested dish that belongs in
 * discovery, and is it named the way English-language sources name it? A second
 * pass over the generator's own "AUTHENTICITY IS PARAMOUNT" prompt — catches
 * inventions/hallucinations the generator lets through. Only runs for genuinely
 * new dishes (dedup handles the already-vetted existing ones). Fails OPEN
 * (authentic, name unchanged) on any error so an LLM hiccup never drops valid
 * dishes.
 *
 * A `name` comes back only when it should actually CHANGE: an unchanged name is
 * reported as absent so callers can skip the rename path (an extra lookup and a
 * re-embed) on the common case.
 */
export async function verifySuggestionAuthenticity(
    suggestion: GenerateSuggestionResponseDto
): Promise<SuggestionReview> {
    try {
        const verdict = await classifySuggestionAuthenticity(suggestion);
        const authentic =
            ATTESTED.includes(verdict.status) &&
            verdict.confidence >= CONFIDENCE_FLOOR;

        if (!authentic || !verdict.name || !isRename(suggestion.name, verdict.name)) {
            return { authentic, status: verdict.status };
        }

        console.log(
            `[Suggestions] Renaming "${suggestion.name}" -> "${verdict.name}"`
        );

        return {
            authentic,
            status: verdict.status,
            name: verdict.name,
            // Keep the name it arrived under as the alternate, unless the
            // reviewer named a better one — a dish renamed away from its native
            // spelling should still be findable by it.
            nameAlt: verdict.nameAlt || suggestion.name,
        };
    } catch (error) {
        console.error(
            `[Suggestions] Authenticity check failed for "${suggestion.name}" — allowing:`,
            error
        );
        return { authentic: true, status: "unknown" };
    }
}

/**
 * Whether a proposed name is a real change rather than a reformatting. Case and
 * surrounding whitespace differences are not worth an extra name lookup and a
 * re-embed.
 */
function isRename(current: string, proposed: string): boolean {
    return current.trim().toLowerCase() !== proposed.trim().toLowerCase();
}
