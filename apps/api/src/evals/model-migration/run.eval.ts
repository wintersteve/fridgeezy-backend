// Must be the first import, not a `config()` call in the module body: the
// Supabase client throws on a missing SUPABASE_URL at *import* time, and imports
// are evaluated before any statement here would run. The other evals in this
// directory get away with `config()` because none of them pull in Supabase.
import "dotenv/config";

import {
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    SubstituteSuggestionLlmDto,
    SubstituteSuggestionLlmSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { canonicalizeName } from "@fridgeezy/toolkit";

import {
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../../modules/recipes/services";
import {
    buildRecipeSystemPrompt,
    buildRecipeUserPrompt,
} from "../../modules/recipes/usecases/generate-recipe/generate-recipe";
import {
    buildSubstitutesUserPrompt,
    SUBSTITUTES_SYSTEM_PROMPT,
} from "../../modules/substitutes/services/generate-substitutes-stream";
import { buildSuggestionsUserPrompt } from "../../modules/suggestions/services/build-suggestions-user-prompt";
import { SUGGESTIONS_SYSTEM_PROMPT } from "../../modules/suggestions/services/generate-suggestions-stream";

import {
    BASELINE,
    BEDROCK_CANDIDATES,
    CONVERSE_CANDIDATES,
    Candidate,
    CompletionChunk,
    streamCompletion,
} from "./candidates";
import {
    RECIPE_FIXTURES,
    SUBSTITUTE_FIXTURES,
    SUGGESTION_FIXTURES,
} from "./fixtures";
import {
    avoidsIngredients,
    coversIngredients,
    emptyScore,
    hasLeakedScaffolding,
    isRealDish,
    NutritionLine,
    rate,
    record,
    Score,
    scoreNutrition,
    scoreTagCardinality,
} from "./scorers";


/**
 * Phase 0 gate for the Bedrock inference migration (TODOS.md).
 *
 * Runs a fixed input set through the OpenAI baseline and each Bedrock candidate
 * using byte-identical prompts, and scores authenticity + structure adherence.
 * Phase 1 does not ship until a candidate matches or beats the baseline here.
 *
 * This costs real money on both providers. Run `--quick` first (one fixture per
 * path, no authenticity judging) to shake out plumbing before a full sweep.
 *
 * Sampling matters more than it looks. Observed on the baseline: the same fixture
 * scored 0/4 on tag cardinality in one run and 4/4 in the next. A single sample
 * per fixture is noise, not a gate — use `--repeat=5` or higher for any run that
 * is meant to inform the Phase 1 go/no-go.
 *
 * Flags:
 *   --quick               one fixture per path, skip the authenticity judge
 *   --repeat=N            run each fixture N times (default 1; use >= 5 to decide)
 *   --skip-authenticity   skip the LLM authenticity judge (the priciest scorer)
 *   --skip-recipes        skip the recipe path (the only one needing Supabase)
 *   --skip-substitutes    skip the substitutes path (needs no Supabase)
 *   --only=<substring>    restrict to candidates whose id matches
 */
const ARGS = process.argv.slice(2);
const has = (flag: string) => ARGS.includes(flag);
const QUICK = has("--quick");
const SKIP_AUTHENTICITY = QUICK || has("--skip-authenticity");
const SKIP_RECIPES = has("--skip-recipes");
const SKIP_SUBSTITUTES = has("--skip-substitutes");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const REPEAT = Math.max(
    1,
    Number(ARGS.find((a) => a.startsWith("--repeat="))?.slice("--repeat=".length) ?? 1)
);

/** Expands the fixture list so each entry runs REPEAT times. */
const sampled = <T>(fixtures: T[]): T[] =>
    (QUICK ? fixtures.slice(0, 1) : fixtures).flatMap((fixture) =>
        Array.from({ length: REPEAT }, () => fixture)
    );

interface CandidateResult {
    candidate: Candidate;
    validJsonl: Score;
    tagCardinality: Score;
    coreIngredients: Score;
    realDish: Score;
    nutrition: Score;
    leaks: number;
    errors: string[];
    elapsedMs: number;
}

/**
 * Passes chunks through untouched while accumulating the raw visible text.
 * The parser only ever sees well-formed lines, so leaked scaffolding would
 * otherwise be invisible — it shows up as a dropped line, not as an error.
 */
async function* tee(
    source: AsyncGenerator<CompletionChunk>,
    sink: { text: string }
): AsyncGenerator<CompletionChunk> {
    for await (const chunk of source) {
        sink.text += chunk.choices[0]?.delta?.content ?? "";
        yield chunk;
    }
}

async function runSuggestionFixtures(
    candidate: Candidate,
    tagTypes: Map<string, string>,
    result: CandidateResult
): Promise<void> {
    const fixtures = sampled(SUGGESTION_FIXTURES);

    for (const fixture of fixtures) {
        const raw = { text: "" };
        const suggestions: GenerateSuggestionResponseDto[] = [];

        try {
            const stream = tee(
                streamCompletion(
                    candidate,
                    SUGGESTIONS_SYSTEM_PROMPT,
                    buildSuggestionsUserPrompt(fixture.request)
                ),
                raw
            );

            for await (const { parsed } of processJsonlStream(stream, [
                GenerateSuggestionResponseSchema,
            ])) {
                suggestions.push(parsed as GenerateSuggestionResponseDto);
            }
        } catch (error) {
            result.errors.push(
                `${fixture.label}: ${error instanceof Error ? error.message : String(error)}`
            );
            record(result.validJsonl, false);
            continue;
        }

        if (hasLeakedScaffolding(raw.text)) result.leaks += 1;

        // The prompt promises EXACTLY 4 recipes. Fewer means lines were emitted
        // that failed schema validation and were dropped, which is precisely the
        // structure-adherence regression this gate exists to catch.
        record(result.validJsonl, suggestions.length === 4);

        const producedIngredients = suggestions.flatMap((s) => s.ingredients);

        if (fixture.requiredIngredients) {
            record(
                result.coreIngredients,
                coversIngredients(producedIngredients, fixture.requiredIngredients)
            );
        }
        if (fixture.forbiddenIngredients) {
            record(
                result.coreIngredients,
                avoidsIngredients(producedIngredients, fixture.forbiddenIngredients)
            );
        }

        for (const suggestion of suggestions) {
            record(
                result.tagCardinality,
                scoreTagCardinality(suggestion, tagTypes)
            );

            if (!SKIP_AUTHENTICITY) {
                // The judge stays on OpenAI for every candidate on purpose: a
                // judge that moved with the candidate would measure the pair, not
                // the candidate.
                record(result.realDish, await isRealDish(suggestion));
            }
        }
    }
}

async function runRecipeFixtures(
    candidate: Candidate,
    unitsPrompt: string,
    tagsPrompt: string,
    result: CandidateResult
): Promise<void> {
    const fixtures = sampled(RECIPE_FIXTURES);

    for (const fixture of fixtures) {
        const raw = { text: "" };
        let nutrition: NutritionLine | undefined;
        let sawHeader = false;
        let ingredientLines = 0;

        try {
            const stream = tee(
                streamCompletion(
                    candidate,
                    buildRecipeSystemPrompt(
                        unitsPrompt,
                        tagsPrompt,
                        fixture.ingredientNames
                    ),
                    buildRecipeUserPrompt(
                        fixture.name,
                        fixture.difficulty,
                        fixture.ingredientNames,
                        fixture.servings
                    )
                ),
                raw
            );

            for await (const { parsed } of processJsonlStream(stream, [
                HeaderSchema,
                NutritionSchema,
                IngredientSchema,
                InstructionSchema,
                TipSchema,
            ])) {
                const line = parsed as { type: string };
                if (line.type === "header") sawHeader = true;
                if (line.type === "nutrition") nutrition = line as unknown as NutritionLine;
                if (line.type === "ingredient") ingredientLines += 1;
            }
        } catch (error) {
            result.errors.push(
                `${fixture.label}: ${error instanceof Error ? error.message : String(error)}`
            );
            record(result.validJsonl, false);
            continue;
        }

        if (hasLeakedScaffolding(raw.text)) result.leaks += 1;

        // A usable recipe needs the header, nutrition, and one line per requested
        // ingredient — the prompt states all three as hard requirements.
        record(
            result.validJsonl,
            sawHeader &&
                nutrition !== undefined &&
                ingredientLines >= fixture.ingredientNames.length
        );
        record(result.nutrition, scoreNutrition(nutrition));
    }
}

/**
 * Substitutes: one JSONL line per requested missing ingredient, echoing the name
 * EXACTLY as asked, in request order.
 *
 * Scored as coverage rather than as prose quality, because coverage is the part
 * the service cannot paper over cheaply. `generate-substitutes-stream` already
 * buffers out-of-order lines, drops duplicates, and fills any ingredient the
 * model skipped with a fallback frame — so a model that names things its own way
 * produces a card of fallbacks, not an error. That degradation is silent in
 * production and invisible to the other scorers; this is what makes it visible.
 *
 * No database: the prompt is built with a null recipe, so it falls back to
 * `recipeName` and the fixture set stays self-contained.
 */
async function runSubstituteFixtures(
    candidate: Candidate,
    result: CandidateResult
): Promise<void> {
    const fixtures = sampled(SUBSTITUTE_FIXTURES);

    for (const fixture of fixtures) {
        const raw = { text: "" };
        const answered = new Set<string>();

        try {
            const stream = tee(
                streamCompletion(
                    candidate,
                    SUBSTITUTES_SYSTEM_PROMPT,
                    buildSubstitutesUserPrompt(fixture.request, null)
                ),
                raw
            );

            for await (const { parsed } of processJsonlStream(stream, [
                SubstituteSuggestionLlmSchema,
            ])) {
                const line = parsed as SubstituteSuggestionLlmDto;

                // An empty `substitutes` array parses but answers nothing, and
                // the prompt forbids refusing an ingredient — so it counts as
                // unanswered rather than as a line.
                const key = canonicalizeName(line.ingredient_name);

                if (key && line.substitutes.length > 0) answered.add(key);
            }
        } catch (error) {
            result.errors.push(
                `${fixture.label}: ${error instanceof Error ? error.message : String(error)}`
            );
            record(result.validJsonl, false);
            continue;
        }

        if (hasLeakedScaffolding(raw.text)) result.leaks += 1;

        // Canonicalised both sides, matching how the service pairs lines back to
        // requests — scoring on the raw string would fail on casing alone and
        // overstate the problem.
        record(
            result.validJsonl,
            fixture.request.missingIngredients.every((ingredient) => {
                const key = canonicalizeName(ingredient.name);

                return key !== null && answered.has(key);
            })
        );
    }
}

async function runCandidate(
    candidate: Candidate,
    tagTypes: Map<string, string>,
    unitsPrompt: string,
    tagsPrompt: string
): Promise<CandidateResult> {
    const result: CandidateResult = {
        candidate,
        validJsonl: emptyScore(),
        tagCardinality: emptyScore(),
        coreIngredients: emptyScore(),
        realDish: emptyScore(),
        nutrition: emptyScore(),
        leaks: 0,
        errors: [],
        elapsedMs: 0,
    };

    const started = Date.now();
    await runSuggestionFixtures(candidate, tagTypes, result);
    if (!SKIP_RECIPES) {
        await runRecipeFixtures(candidate, unitsPrompt, tagsPrompt, result);
    }
    if (!SKIP_SUBSTITUTES) {
        await runSubstituteFixtures(candidate, result);
    }
    result.elapsedMs = Date.now() - started;

    return result;
}

const pct = (score: Score): string => {
    const value = rate(score);
    return Number.isNaN(value) ? "  n/a" : `${(value * 100).toFixed(0).padStart(4)}%`;
};

function printTable(results: CandidateResult[]): void {
    console.log(
        "\ncandidate                 jsonl  tags  ingr  real  nutr  leaks   elapsed"
    );
    console.log("-".repeat(72));

    for (const r of results) {
        console.log(
            `${r.candidate.id.padEnd(24)} ${pct(r.validJsonl)} ${pct(r.tagCardinality)} ${pct(r.coreIngredients)} ${pct(r.realDish)} ${pct(r.nutrition)} ${String(r.leaks).padStart(5)}  ${(r.elapsedMs / 1000).toFixed(1).padStart(6)}s`
        );
    }

    const withErrors = results.filter((r) => r.errors.length > 0);
    if (withErrors.length > 0) {
        console.log("\nerrors:");
        for (const r of withErrors) {
            for (const error of r.errors) {
                console.log(`  ${r.candidate.id}: ${error}`);
            }
        }
    }
}

/**
 * The gate: a Bedrock candidate must match or beat the baseline on every scored
 * dimension, and must not leak scaffolding at all. Reported, not enforced with a
 * non-zero exit — Phase 0 is a decision aid, and a single sampled run is not
 * grounds for an automated pass/fail on a spend decision.
 */
function reportGate(results: CandidateResult[]): void {
    const baseline = results.find((r) => r.candidate.provider === "openai");
    if (!baseline) return;

    console.log("\ngate vs baseline (match or beat on every dimension, zero leaks):");

    for (const r of results.filter((x) => x !== baseline)) {
        const dims: Array<[string, Score, Score]> = [
            ["jsonl", r.validJsonl, baseline.validJsonl],
            ["tags", r.tagCardinality, baseline.tagCardinality],
            ["ingr", r.coreIngredients, baseline.coreIngredients],
            ["real", r.realDish, baseline.realDish],
            ["nutr", r.nutrition, baseline.nutrition],
        ];

        const regressions = dims
            .filter(([, candidate, base]) => {
                const c = rate(candidate);
                const b = rate(base);
                return !Number.isNaN(c) && !Number.isNaN(b) && c < b;
            })
            .map(([name]) => name);

        const passes = regressions.length === 0 && r.leaks === 0;
        const detail = [
            ...regressions.map((d) => `${d} below baseline`),
            ...(r.leaks > 0 ? [`${r.leaks} leak(s)`] : []),
        ];

        console.log(
            `  ${passes ? "✓" : "✗"} ${r.candidate.id.padEnd(24)}${detail.join(", ")}`
        );
    }
}

async function main() {
    const roster = [
        BASELINE,
        ...BEDROCK_CANDIDATES,
        ...CONVERSE_CANDIDATES,
    ].filter(
        (c) => !ONLY || c.id.includes(ONLY)
    );

    if (roster.length === 0) {
        console.error(`No candidate matched --only=${ONLY}`);
        process.exit(1);
    }

    // Name the paths actually running. This used to read "[suggestions only]"
    // whenever recipes were skipped, which stopped being true once substitutes
    // became a third path — and a banner that misreports scope makes every score
    // under it ambiguous.
    const paths = [
        "suggestions",
        ...(SKIP_RECIPES ? [] : ["recipes"]),
        ...(SKIP_SUBSTITUTES ? [] : ["substitutes"]),
    ];

    console.log(
        `Phase 0 eval — ${roster.length} candidate(s) x${REPEAT}${QUICK ? " [quick]" : ""}` +
            `${SKIP_AUTHENTICITY ? " [no authenticity judge]" : ""}` +
            ` [${paths.join(" + ")}]`
    );

    // Tag taxonomy and the units/tags prompt fragments come from Supabase, exactly
    // as production builds them.
    const metadata = await fetchRecipeMetadata();
    const tagTypes = new Map(
        metadata.tags.map((tag) => [tag.name.toLowerCase(), tag.type])
    );
    const unitsPrompt = formatUnitsForPrompt(metadata.units);
    const tagsPrompt = formatTagsForPrompt(metadata.tags);

    const results: CandidateResult[] = [];
    for (const candidate of roster) {
        process.stdout.write(`\nrunning ${candidate.id} ... `);
        results.push(await runCandidate(candidate, tagTypes, unitsPrompt, tagsPrompt));
        process.stdout.write("done");
    }

    printTable(results);
    reportGate(results);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\nEval failed to run:", error);
        process.exit(1);
    });
