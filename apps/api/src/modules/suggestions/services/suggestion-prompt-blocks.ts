import { GenerateSuggestionRequestDto } from "@fridgeezy/schemas";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";

/**
 * The user-turn blocks both suggestion generators are steered by, and the
 * assembly of the single generator's prompt.
 *
 * ## Why this is its own file
 *
 * It holds no Supabase client, no LLM client and no repository — deliberately,
 * so `check-generator-exclusions` can assert the assembly in milliseconds with
 * no key and no database. `buildExistingDishesBlock` used to live in
 * `list-catalog-dishes`, which opens a Supabase client at import, and the
 * single-generator assembly used to be inline in `stream-single-suggestion`,
 * which reaches the whole persist graph. Importing either from a check is what
 * made the check unrunnable — the same trap `suggestion-reveals.ts` was split
 * out to avoid, and for the same reason. **Keep this module free of
 * side-effecting imports.**
 *
 * ## Three lists of names, three different sentences
 *
 * All three end up as a comma-separated list of dish names in a prompt, and
 * collapsing them into one function is the tempting simplification. It is wrong:
 * the wording is the only thing that tells the model WHY a name is on the list,
 * and each reason steers the next generation differently.
 *
 * | Block | The statement it makes | Set by |
 * | --- | --- | --- |
 * | {@link buildExistingDishesBlock} | "the database already holds this" | the feed, to keep a batch novel |
 * | {@link buildExcludedDishesBlock} | "the reader has seen this, or asked for something other than it" | chat's `exclude` |
 * | {@link buildRejectedBlock} | "the gate refused this for not being an established dish" | a notability retry |
 *
 * Telling the model a dish was "rejected for not being established" when the
 * user merely said "something else" steers it away from a whole shape of answer
 * for no reason; telling it a refused dish is "already in the catalog" says
 * nothing about the refusal at all.
 */

/** Trimmed, non-empty, first spelling wins, compared case-insensitively. */
function uniqueNames(names: string[]): string[] {
    return [
        ...new Map(
            names
                .map((name) => name.trim())
                .filter(Boolean)
                .map((name) => [name.toLowerCase(), name])
        ).values(),
    ];
}

/**
 * Dishes the catalogue already holds (empty when there is none).
 *
 * Deduplicated case-insensitively because the caller merges several sources —
 * the catalogue, the client's own "already on screen" list, and the dishes an
 * earlier pass of this same request already emitted.
 */
export function buildExistingDishesBlock(names: string[]): string {
    const unique = uniqueNames(names);

    if (unique.length === 0) return "";

    return `Already in the catalog (do NOT suggest these, nor a variation, translation or spelling variant of one): ${unique.join(", ")}`;
}

/**
 * Dishes the READER has seen or asked not to see.
 *
 * A dish excluded here may well be in the catalogue and may well be a perfectly
 * good dish — neither of the other two framings is true of it. It also carries
 * `exclude`'s second job, the accompanied dish in "what sauce goes with apple
 * strudel", which is why the wording is about what must not be RETURNED rather
 * than about the conversation.
 */
export function buildExcludedDishesBlock(names: string[]): string {
    const unique = uniqueNames(names);

    if (unique.length === 0) return "";

    return `Do NOT return these dishes, nor a variation, translation or spelling variant of one — the user has already seen them or asked for something other than them: ${unique.join(", ")}`;
}

/**
 * Dishes this request already generated and the notability gate refused.
 *
 * Names the reason, which is what stops the model handing back the same SHAPE of
 * answer under a different garnish — the failure measured on 2026-08-24, where
 * five consecutive generations for "brussel sprouts recipe" were all
 * `<method> <ingredient> with <garnish>` and all correctly dropped.
 */
export function buildRejectedBlock(names: string[]): string {
    const unique = uniqueNames(names);

    if (unique.length === 0) return "";

    return `Rejected on this request (not established dishes — do NOT suggest these, nor another plate composed the same way): ${unique.join(", ")}`;
}

/**
 * What the dish is being written to sit BESIDE.
 *
 * Without it, a pairing request reaches the generator as nothing but a query
 * string on the `Ingredients` line — "side dishes for Korean chicken" — which
 * that line's own rule says to read flexibly, as ingredients OR a dish name OR a
 * concept. It usually guesses right and it has no reason to: the one fact that
 * decides the answer is that the named dish is already ON THE TABLE, and the
 * prompt never said so.
 *
 * Stated separately from `Ingredients` for the reason `Dish:` is: a dish handed
 * over on the ingredients line is read as something to cook WITH, and an anchor
 * is the one thing the answer must not contain or be.
 */
const buildAccompanimentLine = (dish: string): string =>
    `Serve alongside: ${dish}. Return a DIFFERENT dish that is eaten at the same meal as it — never that dish, never a variation of it, and never a dish built on it. It is already on the table.`;

/**
 * The clock the dish has to fit inside.
 *
 * A separate line rather than a `formatFilter` entry because it is a CEILING
 * with a unit, not a category — "Max total time: 20 minutes" reads as a
 * constraint where "Time: 20" reads as a label. The wording names the overnight
 * exclusion for the same reason `DISH_TOTAL_TIME_RULE` does: count a marinade
 * or a prove and every dish is over every limit.
 */
const buildTimeLimitLine = (minutes: number): string =>
    `Max total time: ${minutes} minutes, start to plate. Return a dish a cook can genuinely finish in that, counting active work and unattended cooking but NOT overnight steps like marinating or proving. If nothing well known fits, say so by returning the closest thing that does rather than a dish that does not.`;

/**
 * The user turn for ONE generation of the single-suggestion generator.
 *
 * Order is deliberate. `Dish:` first because it is the strongest statement in
 * the prompt, the filter lines next, and the two negative blocks last, where a
 * model reading sequentially meets them with the request already in mind.
 *
 * `request.exclude` reaching here at all is the fix for the defect this file's
 * check pins: the field was declared on the shared DTO and honoured by the batch
 * generator, while `buildSuggestionsUserPrompt` — which renders eight filter
 * lines — never rendered it. Chat, the one caller whose user can say "no,
 * something else", was the one generator that could not hear it.
 */
export function buildSingleSuggestionUserPrompt(
    request: GenerateSuggestionRequestDto,
    options: { dish?: string; accompanies?: string; maxMinutes?: number } = {},
    rejected: string[] = []
): string {
    return [
        options.dish ? `Dish: ${options.dish}` : "",
        options.accompanies ? buildAccompanimentLine(options.accompanies) : "",
        options.maxMinutes ? buildTimeLimitLine(options.maxMinutes) : "",
        buildSuggestionsUserPrompt(request),
        buildExcludedDishesBlock(request.exclude ?? []),
        buildRejectedBlock(rejected),
    ]
        .filter(Boolean)
        .join("\n");
}
