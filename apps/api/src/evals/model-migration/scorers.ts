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
}

export const emptyScore = (): Score => ({ hits: 0, total: 0 });

export const record = (score: Score, ok: boolean): void => {
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
 * Structure adherence for the suggestion path: exactly one component tag, one
 * cuisine tag, one course tag, per the prompt's "Tagging Rules (CRITICAL)".
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

    return counts.component === 1 && counts.cuisine === 1 && counts.course === 1;
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

/** Delegates to the production authenticity gate. Costs an LLM call per dish. */
export async function isRealDish(
    suggestion: GenerateSuggestionResponseDto
): Promise<boolean> {
    return verifySuggestionAuthenticity(suggestion);
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
