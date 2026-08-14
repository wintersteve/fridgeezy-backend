import { generateCompletion } from "@fridgeezy/llm";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";

import { DISH_NAME_ALT_RULE, DISH_NAME_RULE } from "./naming-rules";
import { describeSuggestion } from "./suggestion-signature";

/**
 * The axis here is NOTABILITY — is this dish known by name to the people whose
 * food it is — not tradition. Those are different questions, and gating on the
 * second is what dropped "Chicken Tikka" as `modern_fusion`.
 *
 * `modern_fusion` used to be a status and a rejection. It was the wrong shape
 * twice over: a Korean taco and a California roll are modern fusion and belong
 * in the catalog, while a fusion dish the model invented three seconds ago does
 * not — and the thing separating them is whether anyone has heard of it. So the
 * traditional/modern split is gone, `canonical` is now `well_known` (traditional
 * and modern alike), and the dishes that used to be caught by "not traditional"
 * are caught by `obscure` instead, which is the honest reason to drop them.
 */
export type AuthenticityStatus =
    | "well_known"
    | "regional_variant"
    /**
     * Plausibly real, but not established under any name — the dish nobody could
     * ask for, because there is nothing to ask for it BY.
     *
     * This is the tail the exclusion list drives the generator into: every batch
     * tells it "not these", so as a cuisine fills up it reaches for things like
     * "Persian Chicken with Yogurt and Walnuts". The test that catches it is in
     * the prompt below — a real dish has a NAME, and a description standing in
     * for one means there is no dish behind it.
     */
    | "obscure"
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
/**
 * Statuses allowed into the discovery catalog.
 *
 * **This is also the catalogue's growth limiter, and it is the only one.** The
 * exclusion list handed to the generator grows monotonically ("do NOT suggest
 * these"), so every batch pushes it further down the popularity tail; left
 * ungated, the catalogue grows without bound and its median dish gets more
 * obscure the bigger it gets. A floor that does not move turns that around: a
 * cuisine saturates when the generator can no longer produce a dish notable
 * enough to clear it, and the catalogue converges on "the dishes worth having"
 * rather than on a number someone picked. Do not add a configured cap — raising
 * or lowering THIS is how the size is tuned.
 */
const ATTESTED: AuthenticityStatus[] = ["well_known", "regional_variant"];

const STATUSES: AuthenticityStatus[] = [
    "well_known",
    "regional_variant",
    "obscure",
    "adaptation",
    "not_food",
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
const SYSTEM_PROMPT = `You decide whether a proposed dish is WELL KNOWN enough to enter a discovery catalog, and what it should be CALLED.

## 0. FIRST: is this food at all?

This catalog holds FOOD. Before judging authenticity, decide whether the proposed item is something you EAT or something you DRINK.

THE TEST: what is this thing's PURPOSE — to be eaten, or to be drunk? Answer for the finished item, not for any single ingredient.

- Its purpose is to be drunk -> "not_food". Cocktails and mixed drinks (Mojito, Negroni, Espresso Martini), wine, beer and spirits, mocktails, smoothies, milkshakes, lassi, horchata, agua fresca, juice, hot chocolate, coffee and tea drinks, infusions, kombucha. This applies WHETHER OR NOT it contains alcohol — a virgin daiquiri is as much "not_food" as the original.
- Its purpose is to be eaten -> continue to step 1. Soup, broth, consommé and gazpacho are FOOD: they are eaten, from a bowl, with a spoon, even when sipped from a cup.

A dish that CONTAINS a drink is still food. Coq au vin, beer-battered fish, tiramisu, risotto with white wine, bourbon-glazed ribs, affogato — these are eaten, and the wine or spirit is an ingredient like any other. Never mark one "not_food" because alcohol appears in its ingredient list.

"not_food" is orthogonal to everything below and OUTRANKS it. A Mojito is a perfectly canonical, well-documented Mojito — say "not_food" anyway, with high confidence. You are not judging whether it is real; you are judging whether it is food.

When it is "not_food", stop. Skip step 2, echo the proposed name back unchanged in "name", and set "name_alt" to null.

## 1. Classify the dish into one status

You are judging ONE thing: **is this dish KNOWN BY NAME to the people whose food it is?**

You are NOT judging whether it is traditional, old, or pure. A dish invented in 1985 that everyone now orders by name is exactly as valid as one cooked for six centuries. Chicken Tikka, California Roll, Buffalo Wings, Korean tacos, Nachos, Banh Mi — all fine. Never hold modernity or fusion against a dish; hold only obscurity against it.

"Known" means known WITHIN ITS OWN CULTURE, not known globally. A dish every household in Oaxaca can name is well known even if no one outside Mexico has heard of it. Do not require that an English speaker recognise it — that is step 2's job, and it is a separate question.

Judge the dish THE INGREDIENT LIST DESCRIBES, not the dish the name claims. Read the ingredients FIRST and the name second. A correct, confident, well-spelled name on a dish that is not that dish is the single most common defect reaching you, and the name is exactly what hides it.

TEST ONE — the defining ingredient. Before you may answer "well_known" or "regional_variant", name the one ingredient without which this dish would not BE this dish — the seafood in a ceviche, the egg and cured pork in a carbonara, the cheese in a cacio e pepe, the rice in a risotto, the papaya in a green papaya salad. Then find it in the list. If it is absent or has been swapped for something else, the answer is "adaptation" and nothing else.

  A DIETARY VERSION OF A DISH IS THIS SAME CASE, and it is the one most often missed. Swapping a dish's defining animal, gluten or dairy ingredient for a plant, gluten-free or dairy-free substitute is exactly "swapped for something else": vegan Pad Thai (no fish sauce, no dried shrimp, no egg), vegan carbonara, dairy-free cacio e pepe, gluten-free ramen. All are "adaptation". "Can this be made vegan" is NOT the question and the answer is almost always yes; the question is whether the vegan version is itself a dish people ask for BY NAME.
  - It has its own attested name in its own culture -> judge THAT dish on its own merits. Thai Jay (เจ) cooking, Buddhist temple cuisine, Indian sattvic and Ethiopian fasting dishes are real traditions full of dishes that happen to be vegan and are named in their own right. A dish named Baba Ganoush, Dal or Aloo Gobi is not "a vegan dish", it is a dish.
  - The only name it has is the original plus a dietary word -> "adaptation". A qualifier is not a name.

TEST TWO — can you NAME it? A real dish has a name people ask for it by. A made-up one can only be described. So: if the proposed name reads as a DESCRIPTION of ingredients rather than as a name ("Persian Chicken with Yogurt and Walnuts", "Spiced Lentil Stew with Coconut"), ask whether a real, named dish is hiding behind it.
  - There is one, and this is its literal translation or a plain-English rendering of it -> "well_known". Som Tam described as "Green Papaya Salad" is still Som Tam. Say the real name in step 2.
  - You cannot produce the name it would be asked for by, in any language, because there isn't one -> "obscure". This is a plausible plate of food, not a dish.
A native-language name is NOT automatic proof of a real dish — a model can invent a plausible-sounding one. Apply the same test: do you actually know this dish under this name?

- "well_known": an established dish, recognised by name within its own food culture — traditional (Murgh Makhani, Spaghetti alla Carbonara, Chicken Tikka) or modern (California Roll, Buffalo Wings, Nachos) — AND the ingredients actually constitute it.
- "regional_variant": an attested regional variation of a real dish, itself known by name where it is eaten (e.g. Lao-style green papaya salad). A genuine regional variant differs in ingredients that the TRADITION itself varies; it never simply omits the dish's defining ingredient.
- "obscure": plausibly a real plate of food, but not established under any name — nobody orders this, because there is nothing to order. Also use this for a dish so marginal that only a specialist would recognise it.
- "invention": an arbitrary combination presented as a dish (e.g. "Carbonara with Asparagus"), or a hallucinated / non-existent dish. The difference from "obscure" is that an invention contradicts a real dish or could not exist; an obscure one is merely nameless.
- "unknown": you cannot tell.

Only "well_known" and "regional_variant" belong in a discovery catalog.

This catalog is FINITE by design and already holds the obvious dishes, so you will mostly be shown things near the edge. When you find yourself reasoning "this could plausibly be a dish", that is the answer: it is "obscure". Reserve "well_known" for dishes you actually know.

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

  A DIETARY qualifier — vegan, vegetarian, gluten-free, dairy-free, egg-free — is the one kind you must not TOUCH, in either direction. Leave the name exactly as proposed.
  - NEVER STRIP one. It is never redundant: it says the dish differs in its defining ingredients, which is the opposite of "adds nothing". "Vegan Pad Thai" does NOT become "Pad Thai"; "Gluten-Free Ramen" does NOT become "Ramen". Stripping it is how an adaptation ends up wearing the real dish's name and colliding with it — worse than the duplicate this step exists to prevent, because the user is then shown a dish that is not the one they asked for.
  - NEVER ADD one, and never rewrite a dish's own name into one. If the proposed name contains no dietary word, the name you return contains none either. A dish whose ATTESTED name happens to carry a dietary meaning keeps that name: "Pad Thai Jay" stays "Pad Thai Jay" and does NOT become "Vegan Pad Thai"; the same holds for Jay and Mangsawirat dishes generally, for Buddhist temple cuisine, and for Indian sattvic dishes. Jay is what the dish is CALLED, not a note about what is missing from it, and translating it away destroys the very thing that makes the dish real.
  Whichever way you were tempted to go, leave the name alone and let the status you already chose in step 1 stand. This step never rescues a dish and never condemns one; a name is not evidence.

${DISH_NAME_ALT_RULE}

Echo the proposed name back unchanged unless it clearly breaks Step A or Step C. Renaming a dish that was already right is worse than leaving it alone.

Respond with a single JSON object and nothing else:
{"status":"well_known"|"regional_variant"|"obscure"|"adaptation"|"not_food"|"invention"|"unknown","confidence":0.0-1.0,"name":"...","name_alt":"..."|null}.`;

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

        // Keep the verdict, refuse the name. The status the model chose stands —
        // this only stops the rename from changing what the dish is CALLED.
        if (!preservesDietaryMarking(suggestion.name, verdict.name)) {
            console.warn(
                `[Suggestions] Refused rename "${suggestion.name}" -> "${verdict.name}" — changes the dish's dietary marking`
            );
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

/** Words that describe a MODIFICATION rather than name a dish. */
const DIETARY_QUALIFIERS = [
    "vegan",
    "vegetarian",
    "plant based",
    "gluten free",
    "dairy free",
    "egg free",
    "meat free",
];

/**
 * Words that ARE the dish's name in its own tradition, and happen to carry a
 * dietary meaning. Losing one destroys the dish's identity; a qualifier is a
 * description, this is a name.
 */
const TRADITION_MARKERS = ["jay", "mangsawirat", "shojin", "sattvic", "buddhist"];

/** Lowercased, punctuation flattened, space-padded so a token match is exact. */
const normaliseForMarkers = (name: string): string =>
    ` ${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

const markersIn = (name: string, vocabulary: string[]): string[] => {
    const haystack = normaliseForMarkers(name);
    return vocabulary.filter((term) => haystack.includes(` ${term} `));
};

/**
 * Refuse a rename that changes the dish's DIETARY MARKING. Returns true when the
 * rename is safe to apply.
 *
 * ## Why this is code and not prompt
 *
 * It was prompt, twice, and the model would not comply. Step 2C says a dietary
 * qualifier must never be stripped or added, with "Pad Thai Jay" stays
 * "Pad Thai Jay" written out as a verbatim example — and a --repeat=5 baseline on
 * 2026-08-14 still produced seven violations in one run, including
 * "Thai Drunken Noodles Jay" -> "Vegan Drunken Noodles" three times. The rule is
 * one the model reliably talks itself out of, because renaming to "Vegan X" feels
 * like honesty. The prompt text stays (it gets the common case right and costs
 * nothing); this is what makes it hold.
 *
 * ## Why the directions are not symmetric
 *
 * Three of the four possible moves are harmful and one is an improvement:
 *
 * - ADDING a qualifier mints "Vegan Pad Thai" as a canonical name, which is a
 *   permanent second row beside the real dish.
 * - LOSING a tradition marker destroys the only thing that made the dish
 *   attested. "Pad Thai Jay" is what the dish is CALLED; "Vegan Pad Thai" is a
 *   note about what is missing from it.
 * - STRIPPING a qualifier launders an adaptation into the authentic dish's name,
 *   the GUTTED_DISHES failure.
 * - Swapping a qualifier FOR a tradition marker ("Vegan Pad Thai" ->
 *   "Pad Thai Jay") is the one good move, and is allowed.
 *
 * The classification is untouched either way: this decides what the dish is
 * CALLED, never whether it gets in. A dish the gate judged an adaptation is still
 * dropped, under whichever name it arrived with.
 */
export function preservesDietaryMarking(
    current: string,
    proposed: string
): boolean {
    const currentQualifiers = markersIn(current, DIETARY_QUALIFIERS);
    const proposedQualifiers = markersIn(proposed, DIETARY_QUALIFIERS);
    const currentTraditions = markersIn(current, TRADITION_MARKERS);
    const proposedTraditions = markersIn(proposed, TRADITION_MARKERS);

    const gainedQualifier = proposedQualifiers.some(
        (term) => !currentQualifiers.includes(term)
    );
    const lostQualifier = currentQualifiers.some(
        (term) => !proposedQualifiers.includes(term)
    );
    const gainedTradition = proposedTraditions.some(
        (term) => !currentTraditions.includes(term)
    );
    const lostTradition = currentTraditions.some(
        (term) => !proposedTraditions.includes(term)
    );

    if (gainedQualifier) return false;
    if (lostTradition) return false;
    if (lostQualifier && !gainedTradition) return false;

    return true;
}
