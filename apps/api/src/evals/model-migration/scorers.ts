import { GenerateSuggestionResponseDto } from "@fridgeezy/schemas";

import { verifySuggestionAuthenticity } from "../../modules/suggestions/services/verify-suggestion-authenticity";

/**
 * The five Phase 0 scorers. Each returns hits/total so results aggregate across
 * fixtures into a single comparable rate per candidate.
 *
 * `realDish` reuses the production authenticity gate rather than defining a
 * second notion of "real" — the migration has to preserve the behaviour the app
 * actually ships, and that gate is already calibrated (see
 * calibrate-authenticity.eval.ts).
 */
export interface Score {
    hits: number;
    total: number;
    /**
     * Judgements that could not be MADE, as opposed to judgements that came back
     * negative. Excluded from `total` so they cannot be read as failures.
     *
     * Only the authenticity scorer can produce these, and only when its LLM call
     * fails — which on 2026-08-14 it did six times in one `--repeat=5` run, all
     * gpt-4o rate limits. Because the production gate fails OPEN, each one was
     * counted as "authentic" for a dish the fixture expected to be dropped, and
     * `real` reported 79% against a true value of ~90%. Nothing in the summary
     * said any judgement was missing, so the run looked like a model regression.
     */
    unscored: number;
}

export const emptyScore = (): Score => ({ hits: 0, total: 0, unscored: 0 });

/** `null` means the judgement did not happen — see {@link Score.unscored}. */
export const record = (score: Score, ok: boolean | null): void => {
    if (ok === null) {
        score.unscored += 1;
        return;
    }

    score.total += 1;
    if (ok) score.hits += 1;
};

export const rate = (score: Score): number =>
    score.total === 0 ? Number.NaN : score.hits / score.total;

/**
 * Raw-text signals that the model leaked internal scaffolding into the visible
 * response. On the JSONL paths this is not cosmetic: a leaked tag lands inside
 * the text that gets split on newlines and parsed, so the affected line fails
 * schema validation and is silently dropped.
 */
const LEAK_MARKERS = [/<thinking>/i, /<\/thinking>/i, /```/];

export function hasLeakedScaffolding(rawText: string): boolean {
    return LEAK_MARKERS.some((marker) => marker.test(rawText));
}

/**
 * Structure adherence for the suggestion path: one course tag, one OR two
 * cuisine tags, and at most one component tag, per the prompt's "Tagging Rules
 * (CRITICAL)".
 *
 * Each bound is the prompt's, not a tighter guess — a scorer stricter than the
 * rule it scores reports correct output as a regression, and both of these did:
 *
 * - **component `<= 1`.** Exact until 2026-08-14, back when every recipe was
 *   required to carry one and `dish` was the catch-all for the ~87% that are not
 *   components at all. A component tag is now written only for a genuine building
 *   block, so zero is the correct and overwhelmingly common answer.
 * - **cuisine 1 OR 2.** Exact until 2026-08-14, while the prompt has always said
 *   "1 OR 2 cuisine tags per recipe … when the dish genuinely belongs to two
 *   traditions at once: Tex-Mex is american + mexican, Nikkei is japanese +
 *   peruvian". So every correctly-tagged fusion dish scored as a failure. Caught
 *   when a baseline run returned Chicken Tikka Masala as `british, indian` — a
 *   textbook case of the rule being followed — and the harness marked it wrong.
 *
 * Note the direction of the harm: this scorer gates a model migration, so a
 * false failure here argues against a candidate that was in fact behaving.
 *
 * `tagTypes` maps tag name -> type and comes from the live `tags` table, so this
 * scores against the taxonomy the app actually persists rather than a hardcoded
 * list that would rot.
 */
export function scoreTagCardinality(
    suggestion: GenerateSuggestionResponseDto,
    tagTypes: Map<string, string>
): boolean {
    const counts = { component: 0, cuisine: 0, course: 0 };

    for (const tag of suggestion.tags) {
        const type = tagTypes.get(tag.toLowerCase());
        if (type === "component") counts.component += 1;
        else if (type === "cuisine") counts.cuisine += 1;
        else if (type === "course") counts.course += 1;
    }

    return (
        counts.component <= 1 &&
        counts.cuisine >= 1 &&
        counts.cuisine <= 2 &&
        counts.course === 1
    );
}

/**
 * Whether every required ingredient is present somewhere in the returned set.
 * Substring matching in both directions, because the model legitimately varies
 * granularity ("egg" vs "egg yolk", "pork" vs "ground pork").
 */
export function coversIngredients(
    produced: string[],
    required: string[]
): boolean {
    const normalized = produced.map((name) => name.toLowerCase());

    return required.every((needle) => {
        const target = needle.toLowerCase();
        return normalized.some(
            (name) => name.includes(target) || target.includes(name)
        );
    });
}

export function avoidsIngredients(
    produced: string[],
    forbidden: string[]
): boolean {
    const normalized = produced.map((name) => name.toLowerCase());
    return !forbidden.some((needle) =>
        normalized.some((name) => name.includes(needle.toLowerCase()))
    );
}

/**
 * Delegates to the production authenticity gate. Costs an LLM call per dish.
 *
 * Returns `null` when the gate could not reach a verdict, so the caller can leave
 * it out of the score rather than counting a missing judgement as a wrong one.
 *
 * ## How a non-judgement is detected without touching production
 *
 * The gate fails OPEN — on any API error it returns exactly
 * `{ authentic: true, status: "unknown" }`. That pair is unreachable on the happy
 * path: `authentic` requires `ATTESTED.includes(status)`, and `unknown` is not in
 * ATTESTED, so a model that genuinely answers "unknown" scores `authentic: false`.
 * The combination is therefore a reliable signal of the catch block, and reading
 * it costs no change to the gate and no second copy of its ATTESTED +
 * CONFIDENCE_FLOOR rule — which the note at the top of this file is explicit
 * about not wanting.
 *
 * Fail-open is right for production: a throttled judgement should let a dish
 * through rather than break a live stream. It is wrong for measurement, which is
 * the whole distinction this function draws.
 *
 * Retried before giving up, because the failure that produces this is transient
 * by nature — a token-per-minute ceiling clears in under a minute. The retry is
 * just "ask again", so it stays free of any knowledge of why the call failed.
 */
export async function isRealDish(
    suggestion: GenerateSuggestionResponseDto
): Promise<boolean | null> {
    const ATTEMPTS = 3;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const review = await verifySuggestionAuthenticity(suggestion);
        const judged = !(review.authentic && review.status === "unknown");

        if (judged) return review.authentic;

        if (attempt < ATTEMPTS) {
            // 2s, then 8s. A TPM window is 60s, so this does not try to outwait
            // one — it steps aside for the burst that tripped it.
            const backoffMs = 2000 * 4 ** (attempt - 1);
            console.warn(
                `  [authenticity] no verdict for "${suggestion.name}" (attempt ${attempt}/${ATTEMPTS}) — retrying in ${backoffMs}ms`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
    }

    console.warn(
        `  [authenticity] giving up on "${suggestion.name}" — excluded from the score`
    );
    return null;
}

/**
 * Nutrition must be present and non-zero. A recipe that streams
 * `{"kcal":0,"carbs":0,...}` validates against NutritionSchema but is useless in
 * the app, so schema validity alone does not cover this.
 */
export interface NutritionLine {
    kcal: number;
    carbs: number;
    protein: number;
    fat: number;
}

export function scoreNutrition(nutrition: NutritionLine | undefined): boolean {
    if (!nutrition) return false;
    return (
        nutrition.kcal > 0 &&
        nutrition.carbs > 0 &&
        nutrition.protein > 0 &&
        nutrition.fat > 0
    );
}
