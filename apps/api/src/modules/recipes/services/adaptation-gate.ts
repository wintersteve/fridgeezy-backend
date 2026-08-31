import { generateCompletion } from "@fridgeezy/llm";
import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";
import { classifyError } from "@fridgeezy/streaming-server";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";

import { classifySuggestionAuthenticity } from "../../suggestions/services/verify-suggestion-authenticity";

/**
 * Whether a dish survives having one ingredient swapped out — the question the
 * near-miss card deliberately does not answer.
 *
 * `find_near_miss_recipes` can say that Margherita Pizza is one ingredient from
 * dairy-free and that the ingredient is the mozzarella. It cannot say whether a
 * Margherita without mozzarella is still a Margherita, because nothing
 * structural distinguishes that from Apfelpfannkuchen without butter. Its four
 * gates are tuned to refuse the cases where the blocker is obviously a
 * protagonist; this is what settles the rest, and it is why the card only ever
 * names the obstacle while this is what may claim a swap.
 *
 * ## It is the authenticity gate, pointed at a hypothetical
 *
 * `classifySuggestionAuthenticity`'s `adaptation` status already means exactly
 * this: *a real dish with a DEFINING ingredient removed or swapped*. Its prompt
 * carries the "name the defining ingredient, then find it in the list" test and
 * the paragraph about dietary versions specifically — "vegan carbonara,
 * dairy-free cacio e pepe, gluten-free ramen. All are adaptation." So the dish
 * is described to it with the swap ALREADY APPLIED, and an `adaptation` verdict
 * is the refusal.
 *
 * ## Deliberately NOT `verifySuggestionAuthenticity`
 *
 * That wrapper fails **open** — it returns `{ authentic: true }` on any error,
 * so an LLM hiccup never drops a valid dish. Right there, and exactly backwards
 * here. On the generation path a fail-open costs one questionable catalogue row
 * that dedup and the next reviewer can still catch. Here it would hand somebody
 * a "dairy-free Beurre Blanc" because a request timed out. So this calls the
 * raw classifier and treats every throw as a refusal.
 */
export type AdaptationVerdict =
    /** The dish survives. `substitute` is what replaces the blocker. */
    | {
          allowed: true;
          substitute: string;
          /** The status the gate actually returned, for the log. */
          status: string;
          confidence: number;
      }
    /**
     * No adaptation is offered. `reason` is for the log and for choosing the
     * words shown; `retryable` says whether an identical retry could plausibly
     * land, which is the difference between "ask again in a minute" and "this
     * dish is not adaptable".
     */
    | {
          allowed: false;
          reason:
              | "defining_ingredient"
              | "not_attested"
              | "no_substitute"
              | "low_confidence"
              | "gate_unavailable";
          detail: string;
          retryable: boolean;
      };

/**
 * Minimum confidence for the gate to allow a swap.
 *
 * Higher than `verify-suggestion-authenticity`'s own 0.6 floor, and the
 * asymmetry is the point. There, an uncertain verdict costs a catalogue row
 * that several other layers still inspect. Here it costs a person a dish
 * presented as suiting a diet it does not, cooked from it, with nothing
 * downstream to catch it. When the model is unsure whether a Margherita
 * survives losing its mozzarella, the honest answer is not to offer one.
 *
 * Set by hand and NOT fitted — the same exception `TIME_BAND_MAX_MINUTES` and
 * `TASTE_SIGNAL_MIN_OCCURRENCES` occupy. There is no distribution behind it;
 * it is a statement about which way to be wrong. Do not add a `calibrate*`
 * target for it.
 */
const GATE_CONFIDENCE_FLOOR = 0.75;

/** The only verdicts under which a dish is still itself after the swap. */
const SURVIVES = ["well_known", "regional_variant"];

/**
 * The verdict that means the swap DESTROYED the dish, as opposed to the dish
 * never having been attested in the first place.
 *
 * The distinction costs nothing and matters twice. It is the difference between
 * a truthful log line and a misleading one — the first time this ran end to end
 * it refused a fixture called "Zzadapt Skillet Pancake" and reported
 * `defining_ingredient`, when what had actually happened is that no such dish
 * exists and the gate said `obscure`. And it is the difference between two
 * sentences to the reader: "a Beurre Blanc without butter is not a Beurre
 * Blanc" is about the swap, while "we cannot vouch for this dish" is about the
 * recipe — which is the honest answer for somebody's IMPORTED cookbook page,
 * since the gate has never heard of it and never will.
 *
 * Both refuse. Fail-closed does not depend on telling them apart; only the
 * words do.
 */
const DESTROYED_BY_SWAP = "adaptation";

const SUBSTITUTE_PROMPT = `You name ONE replacement for a single ingredient in a specific dish, so that the dish suits a dietary restriction.

You are NOT judging whether the swap is a good idea — something else does that, after you. Your only job is to name the substitute a cook actually reaching for this would use.

Rules:
- Name a REAL, ordinary ingredient. "Plant-based alternative" is not an ingredient; "olive oil" is.
- It must itself satisfy the restriction. Replacing butter for a dairy-free cook with ghee is not an answer.
- Prefer what the dish's own cuisine would use. Tamari for soy sauce in a Japanese dish, oil for butter in a German pancake, cashew cream for dairy cream in an Indian one.
- It must do the same JOB in the dish — a fat for a fat, an acid for an acid, a binder for a binder.
- If nothing real would do the job here, say so. That is a legitimate answer and is better than inventing one.

Respond with a single JSON object and nothing else:
{"substitute":"...","confident":true|false}

Set "confident" to false, and "substitute" to "", when no ordinary ingredient would do the job in this dish.`;

/**
 * Ask for the swap the gate will then judge.
 *
 * A separate, cheap call rather than folded into the gate, because the two are
 * different questions and the gate's prompt is one of the most carefully tuned
 * in this repo — `GUTTED_DISHES` pins its hardest case, and prompt edits there
 * have a documented habit of restoring it. Handing it a second job would put
 * that at risk to save a few cents on a call that runs once per cook per dish.
 *
 * A small model on purpose: this is a lookup with a strict schema, not a
 * judgement. The judgement is the next call and it runs on gpt-4o.
 */
async function proposeSubstitute(
    dishName: string,
    blocker: string,
    diets: string[]
): Promise<string | null> {
    const { text } = await generateCompletion({
        model: { openai: "gpt-4.1-mini" },
        label: "adaptation.substitute",
        system: SUBSTITUTE_PROMPT,
        user: [
            `dish: ${dishName}`,
            `ingredient to replace: ${blocker}`,
            `restriction(s) the replacement must satisfy: ${diets.join(", ")}`,
        ].join("\n"),
        json: true,
        maxTokens: { openai: 60, bedrock: 1024 },
    });

    if (!text) return null;

    const parsed = JSON.parse(text) as {
        substitute?: unknown;
        confident?: unknown;
    };

    if (parsed.confident !== true) return null;

    const substitute =
        typeof parsed.substitute === "string" ? parsed.substitute.trim() : "";

    if (!substitute) return null;

    // A "substitute" that is the blocker under another spelling is not one, and
    // it is the failure mode a model reaches for when it cannot think of an
    // answer but has been asked to be confident. Compared on the canonical id,
    // the rule `ingredients.canonical_id` is built with, so "Butter" and
    // "butter" collapse — the same comparison `compileBlacklist` uses and for
    // the same reason.
    if (ingredientCanonicalId(substitute) === ingredientCanonicalId(blocker)) {
        return null;
    }

    return substitute;
}

/**
 * What the gate is judging — and it must be the dish AS THE WORLD KNOWS IT.
 *
 * ## The verdict is only as good as these strings
 *
 * `describeSuggestion` renders these four fields verbatim into the prompt, so
 * the gate is reading a name, a tag list and an ingredient list and nothing
 * else. Degrade them and it does not degrade gracefully — it inverts. Measured
 * 2026-08-30 while building this: given ingredients named `Zzadapt Butter`,
 * `Zzadapt Plain Flour` and no tags at all, the gate REFUSED Apfelpfannkuchen
 * (butter is a medium; it should adapt) and ALLOWED Beurre Blanc (butter is the
 * dish; it must not). Both wrong, in the two directions that matter, from
 * nothing but fixture noise in the input.
 *
 * The same call with real ingredient names and the dish's own cuisine and
 * course tags got both right first time.
 *
 * ## And the subtler half, which looks like a valid fixture
 *
 * Clean names are not enough — the ingredient list has to actually BE the dish.
 * A four-ingredient "Apfelpfannkuchen" of flour, butter, apple and sugar (no
 * egg, no milk) flipped between runs: `well_known` on one, `obscure` at 0.9 on
 * the next, i.e. allowed and then refused for the same input. Adding the egg
 * and a zest — six ingredients, an actual pancake — gave `well_known` at 0.9,
 * 0.95 and 1.0 on three consecutive runs.
 *
 * So an apparently-unstable gate is the more likely reading of a thin recipe
 * than of a flaky model, and `obscure` on a CATALOGUE dish should be read as
 * "this row does not look like its own name" rather than as a verdict. Chasing
 * that as non-determinism is the wrong trail; check the ingredient list first.
 *
 * In production these come off `fetchRecipe`, so they are the catalogue's own
 * strings and this is not a live hazard. It is a hazard for anyone TESTING this
 * or feeding it a partially-populated recipe: a gate given rubbish returns a
 * confident verdict rather than an error, and there is no way to tell from the
 * outside.
 */
export interface AdaptationGateInput {
    /** The dish, under the name the catalogue holds it by. */
    name: string;
    nameAlt?: string | null;
    /** Its tags, as names — the gate reads cuisine and course off these. */
    tags: string[];
    /** Every ingredient of the recipe as it stands, by name. */
    ingredients: string[];
    /** The one that has to go. */
    blocker: string;
    /** The diets the swap must satisfy, as readable names ("dairy free"). */
    diets: string[];
}

/**
 * Decide whether this dish may be adapted, and to what.
 *
 * **Refuses on anything it cannot positively confirm.** There are four ways to
 * be refused and only one way to be allowed, and that shape is deliberate: the
 * caller cannot accidentally treat an error as consent, because there is no
 * verdict that means "probably fine".
 *
 * Runs on TAP, never eagerly. Two model calls, once per cook per dish family —
 * after that the variant exists and `recipe_family_defaults` serves it for
 * nothing, the same economics `decideReuse` already has.
 */
export async function runAdaptationGate(
    input: AdaptationGateInput
): Promise<AdaptationVerdict> {
    const { name, nameAlt, tags, ingredients, blocker, diets } = input;

    let substitute: string | null;

    try {
        substitute = await proposeSubstitute(name, blocker, diets);
    } catch (error) {
        // Classified rather than swallowed, so an exhausted credit balance is
        // legible in CloudWatch as `provider_quota_exhausted` / not retryable
        // rather than as a generic 429 somebody backs off against forever.
        const classified = classifyError(error);

        console.error(
            `[AdaptationGate] Could not propose a substitute for "${blocker}" in "${name}" — refusing: ${classified.code} (${classified.fault})`,
            error
        );

        return {
            allowed: false,
            reason: "gate_unavailable",
            detail: classified.code,
            retryable: classified.retryable,
        };
    }

    if (!substitute) {
        console.log(
            `[AdaptationGate] No ordinary substitute for "${blocker}" in "${name}" — refusing`
        );

        return {
            allowed: false,
            reason: "no_substitute",
            detail: blocker,
            retryable: false,
        };
    }

    // The dish AS IT WOULD BE. The gate judges this, not the recipe on file —
    // asking it about the unmodified dish would return `well_known` every time,
    // since the unmodified dish is exactly what the catalogue holds.
    const blockerId = ingredientCanonicalId(blocker);
    const swapped: GenerateSuggestionResponseDto = {
        name,
        name_alt: nameAlt ?? null,
        description: `${name}, with ${blocker} replaced by ${substitute}.`,
        difficulty: "medium",
        tags,
        ingredients: ingredients.map((item) =>
            ingredientCanonicalId(item) === blockerId ? substitute : item
        ),
    } as GenerateSuggestionResponseDto;

    try {
        const verdict = await classifySuggestionAuthenticity(swapped);

        if (!SURVIVES.includes(verdict.status)) {
            const destroyed = verdict.status === DESTROYED_BY_SWAP;

            console.log(
                `[AdaptationGate] "${name}" refused for ${blocker} -> ${substitute}: ${verdict.status} (${verdict.confidence})`
            );

            return {
                allowed: false,
                reason: destroyed ? "defining_ingredient" : "not_attested",
                detail: destroyed ? blocker : verdict.status,
                // Neither is a matter of timing. A dish is not a
                // defining-ingredient case one minute and not the next, and an
                // unattested dish does not become attested on a retry — both
                // would buy another paid call and the same answer.
                retryable: false,
            };
        }

        if (verdict.confidence < GATE_CONFIDENCE_FLOOR) {
            console.log(
                `[AdaptationGate] "${name}" with ${blocker} -> ${substitute} scored ${verdict.confidence} < ${GATE_CONFIDENCE_FLOOR} — refusing`
            );

            return {
                allowed: false,
                reason: "low_confidence",
                detail: `${verdict.status} ${verdict.confidence}`,
                retryable: false,
            };
        }

        console.log(
            `[AdaptationGate] "${name}": ${blocker} -> ${substitute} allowed (${verdict.status}, ${verdict.confidence})`
        );

        return {
            allowed: true,
            substitute,
            status: verdict.status,
            confidence: verdict.confidence,
        };
    } catch (error) {
        const classified = classifyError(error);

        console.error(
            `[AdaptationGate] Gate call failed for "${name}" — refusing: ${classified.code} (${classified.fault})`,
            error
        );

        return {
            allowed: false,
            reason: "gate_unavailable",
            detail: classified.code,
            retryable: classified.retryable,
        };
    }
}
