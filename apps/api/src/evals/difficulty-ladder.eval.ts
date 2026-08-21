// Must be the first import — the Supabase client throws on a missing
// SUPABASE_URL at *import* time, before any statement in this file would run.
import "dotenv/config";

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { generateStream } from "@fridgeezy/llm";

import {
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../modules/recipes/services";
import {
    buildRecipeSystemPrompt,
    buildRecipeUserPrompt,
} from "../modules/recipes/usecases/generate-recipe/generate-recipe";

/**
 * Does the difficulty ladder actually rise?
 *
 * Every other difficulty guarantee in this repo is a prompt sentence. Nothing
 * checked that a recipe generated at `hard` is more involved than the SAME dish
 * at `easy` — so when the suggestion generators and the recipe generators drifted
 * a full rung apart (`easy` meaning "the standard authentic version" on one side
 * and "beginner-friendly" on the other), both halves went on producing valid
 * output and nothing reported it for as long as it lasted. This is the missing
 * measurement.
 *
 * ## Within a dish, never across dishes
 *
 * The comparison is one dish at three levels. Comparing a hard pancake against
 * an easy bourguignon measures the dish, not the level, and would report a rising
 * ladder from a generator that ignored difficulty entirely. Every number below is
 * read down a single dish's column.
 *
 * ## Two different questions, deliberately scored apart
 *
 *  1. **Does the ladder rise?** More method at each rung: steps, distinct
 *     equipment, named advanced technique, from-scratch components. Reported,
 *     never asserted at low sample sizes — see REPEAT.
 *  2. **Does the dish survive the climb?** Every defining ingredient still
 *     present at every level. This one IS asserted, and a failure exits non-zero,
 *     because it is the `GUTTED_DISHES` class: a dish stripped of what makes it
 *     itself, still wearing an impeccable name. `DIFFICULTY_RULE` promises this
 *     in a sentence ("a defining ingredient stays in at every rung"); here is the
 *     only thing that checks it.
 *
 * The two fail in opposite directions and one can hide the other. A generator
 * that answers `easy` by deleting the seafood from a ceviche scores beautifully
 * on question 1 — fewer steps, less equipment — while producing exactly the dish
 * the authenticity gate exists to reject.
 *
 * ## What it measures, and what it cannot
 *
 * It drives the PRODUCTION recipe path — `buildRecipeSystemPrompt` +
 * `buildRecipeUserPrompt`, the same pair `generate-recipe` and `promote` send —
 * so it measures `DIFFICULTY_RULE` as actually shipped rather than a copy.
 *
 * It does NOT cover `escalate-difficulty`, which rewrites an existing recipe
 * rather than generating one and needs a persisted row to start from. That path
 * has its own prompt with its own rules for climbing, and it is the obvious
 * second half of this eval; it is left out because the setup cost is a database
 * fixture rather than because the path matters less.
 *
 * **Ingredient COUNT is not a signal here, by construction.** The user prompt
 * says "Use ONLY these ingredients", so the model cannot answer `hard` by adding
 * specialty aromatics the way the escalate prompt invites. The ladder has to show
 * up in the METHOD, which is why the metrics below are all about steps, tools and
 * technique. A future version that relaxes the ingredient list should start
 * counting them.
 */

const OUT_DIR = join(__dirname, "..", "..", "eval-output", "difficulty-ladder");

const LEVELS = ["easy", "medium", "hard"] as const;

type Level = (typeof LEVELS)[number];

interface Dish {
    name: string;
    servings: number;
    ingredients: string[];
    /**
     * The ingredients without which this is a different dish.
     *
     * Matched as substrings against the generated ingredient names, so "squid"
     * catches "squid rings". Keep them to what the dish is genuinely defined by —
     * a list padded with onions and salt turns the identity check into a check
     * that the model can write an ingredient list.
     */
    defining: string[];
}

/**
 * One dish per rung of the difficulty range the catalogue actually holds, so a
 * generator that collapses everything toward the middle is visible: a dish that
 * is inherently simple has room to climb, one that is inherently involved has
 * room to fall.
 */
const DISHES: Dish[] = [
    {
        name: "Spaghetti alla Carbonara",
        servings: 4,
        ingredients: [
            "spaghetti",
            "guanciale",
            "egg yolk",
            "pecorino romano",
            "black pepper",
            "salt",
        ],
        // The emulsion dish: no cream, and the pork and the sheep's cheese are
        // both non-negotiable. A carbonara that loses its guanciale at `easy` is
        // the failure this fixture is here to catch.
        defining: ["guanciale", "egg", "pecorino"],
    },
    {
        name: "Coq au Vin",
        servings: 4,
        ingredients: [
            "chicken",
            "red wine",
            "bacon lardons",
            "pearl onion",
            "mushroom",
            "carrot",
            "garlic",
            "thyme",
            "butter",
            "flour",
        ],
        defining: ["chicken", "wine"],
    },
    {
        name: "Tomato Soup",
        servings: 4,
        ingredients: [
            "tomato",
            "onion",
            "garlic",
            "vegetable stock",
            "olive oil",
            "basil",
            "salt",
            "black pepper",
        ],
        // The floor case. A dish this plain has nowhere to go but up, so it is
        // where a generator that ignores `hard` shows up most clearly.
        defining: ["tomato"],
    },
];

/**
 * Technique the recipe NAMES, as a proxy for technique it demands.
 *
 * Deliberately conservative: a term earns its place only if a beginner recipe
 * for the same dish would not ask for it. Common verbs every recipe uses at
 * every level — stir, fold, rest, toast, strain, season — are excluded on
 * purpose, because including them measures recipe length twice and calls the
 * second copy technique.
 *
 * **This is a lexical proxy and it has a real blind spot**: a step can demand a
 * technique without naming it ("keep the pan off the heat and add the eggs a
 * little at a time" is tempering). It therefore UNDERCOUNTS, which is the safe
 * direction — it cannot invent a rising ladder, only miss one. Read it as
 * directional evidence beside the step and equipment columns, never as a score
 * on its own.
 *
 * **Patterns, not substrings, and that is not fussiness.** The first version
 * matched `"temper"` as a substring and scored every step that mentioned
 * TEMPERATURE — a word `TEMPERATURE_RULES` requires the model to use — so the
 * metric was reading the thermometer and reporting it as skill. Anchored
 * alternations are the only form that can tell `temper the eggs` from `room
 * temperature`, and the same trap is waiting in `cure`/`curing` vs `curry`,
 * `skim` vs `skimmed milk`, and `render` vs `rendered`.
 */
const TECHNIQUE_PATTERNS: RegExp[] = [
    /\bemulsif(y|ies|ied|ying|ication)\b/i,
    // NOT "temperature" — see above.
    /\btemper(s|ed|ing)?\b/i,
    /\bconfit\b/i,
    /\brender(s|ed|ing)?\b/i,
    /\bdeglaz(e|es|ed|ing)\b/i,
    /\bblanch(es|ed|ing)?\b/i,
    /\bsous[- ]vide\b/i,
    /\bclarif(y|ies|ied|ying)\b/i,
    /\blaminat(e|es|ed|ing)\b/i,
    /\bbrunoise\b/i,
    /\bjulienne(d)?\b/i,
    /\bchiffonade\b/i,
    // Both spellings; the model uses either.
    /\bcaramelis(e|es|ed|ing)\b/i,
    /\bcarameliz(e|es|ed|ing)\b/i,
    /\bflamb(e|é)(s|ed|ing)?\b/i,
    /\bmacerat(e|es|ed|ing)\b/i,
    /\bsabayon\b/i,
    /\broux\b/i,
    // "beurre blanc", "beurre noisette", "monter au beurre".
    /\bbeurre\b/i,
    /\bmonter\b/i,
    /\bspatchcock(s|ed|ing)?\b/i,
    /\btruss(es|ed|ing)?\b/i,
    /\bfillet(s|ed|ing)?\b/i,
    /\bde-?bon(e|es|ed|ing)\b/i,
    // NOT "curry".
    /\bcur(e|es|ed|ing)\b/i,
    /\bferment(s|ed|ing|ation)?\b/i,
    /\bbrais(e|es|ed|ing)\b/i,
    /\bpoach(es|ed|ing)?\b/i,
    /\bbast(e|es|ed|ing)\b/i,
    // NOT "skimmed milk".
    /\bskim(s|med|ming)?\b(?!\s+milk)/i,
    /\bdegreas(e|es|ed|ing)\b/i,
    /\binfus(e|es|ed|ing|ion)\b/i,
    /\breduc(e|es|ed|ing)\b(?=[^.]*\b(by|until|to)\b)/i,
    /\breduction\b/i,
    /\bknead(s|ed|ing)?\b/i,
    /\bproof(s|ed|ing)?\s+the\b/i,
    /\bprov(e|es|ed|ing)\s+the\b/i,
];

/**
 * Claims that the recipe MAKES a component an easier version would buy — the
 * clause `DIFFICULTY_RULE` uses to define its top rung, and the one thing in
 * that definition a reader can check from the output.
 *
 * **Expect this column to read 0.0 on most dishes here, and do not read that as
 * a broken metric.** The generation path fixes the ingredient list ("Use ONLY
 * these ingredients"), so there is usually nothing left to make from scratch —
 * a tomato soup handed `vegetable stock` as an ingredient cannot answer `hard`
 * by making stock. The clause it tests belongs mostly to `escalate-difficulty`,
 * whose prompt leads with "make what the easier version buys" and whose input
 * is not constrained this way. It is kept because it costs nothing and it is
 * the column that will move first if the ingredient list is ever relaxed.
 */
const SCRATCH_RE = /\b(from scratch|home-?made|make your own|homemade)\b/i;

interface Line {
    type?: string;
    name?: string;
    text?: string;
    title?: string;
    equipment?: string[];
    prepTime?: number;
    cookTime?: number;
    [key: string]: unknown;
}

const parseJsonl = (raw: string): Line[] =>
    raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as Line];
            } catch {
                return [];
            }
        });

/** One generation's worth of numbers. */
interface Sample {
    steps: number;
    /** DISTINCT tools across the whole recipe, not a per-step total. */
    equipment: number;
    /** Distinct technique terms named anywhere in the method. */
    technique: number;
    scratch: number;
    minutes: number;
    ingredients: number;
    /** Defining ingredients found. Anything below the dish's own count is a failure. */
    definingFound: number;
    /** Which ones were missing, so the failure is legible rather than a number. */
    definingMissing: string[];
}

const measure = (lines: Line[], dish: Dish): Sample => {
    const steps = lines.filter((line) => line.type === "instruction");
    const ingredients = lines.filter((line) => line.type === "ingredient");
    const header = lines.find((line) => line.type === "header");

    const equipment = new Set<string>();
    const technique = new Set<string>();
    let scratch = 0;

    for (const step of steps) {
        for (const tool of step.equipment ?? []) {
            const key = tool.toLowerCase().trim();
            if (key) equipment.add(key);
        }

        // Title and text together: the headline names the step's purpose, which
        // is often exactly where the technique word lives ("Temper the eggs").
        // Not lowercased — the patterns carry their own `i` flag, and folding
        // case here would not help the word boundaries that do the real work.
        const prose = `${step.title ?? ""} ${step.text ?? ""}`;

        for (const pattern of TECHNIQUE_PATTERNS) {
            if (pattern.test(prose)) technique.add(pattern.source);
        }

        if (SCRATCH_RE.test(prose)) scratch += 1;
    }

    const names = ingredients
        .map((item) => (item.name ?? "").toLowerCase())
        .join(" | ");

    const definingMissing = dish.defining.filter(
        (needle) => !names.includes(needle.toLowerCase())
    );

    return {
        steps: steps.length,
        equipment: equipment.size,
        technique: technique.size,
        scratch,
        minutes: (header?.prepTime ?? 0) + (header?.cookTime ?? 0),
        ingredients: ingredients.length,
        definingFound: dish.defining.length - definingMissing.length,
        definingMissing,
    };
};

/**
 * How many times to generate each dish at each level.
 *
 * **The ladder verdict is withheld below 3, and that is not caution.** Nine
 * generations of the byte-identical shipped prompt spread 6 to 12 steps in
 * `step-structure.eval.ts`, and one dish alone gave 6/7/8 — a range wider than
 * any difference a rung is likely to produce. So at REPEAT=1 a rising steps
 * column is as likely to be noise as signal, and the footer says so rather than
 * leaving a reader to infer it.
 *
 * Default stays 1 anyway, matching its sibling: an exploratory run is 9
 * generations and should stay cheap. Cost is linear — REPEAT=3 is 27.
 *
 * The IDENTITY check needs no repeats to be worth reading. One run that drops
 * the guanciale from a carbonara has found a real bug.
 */
const REPEAT = Math.max(
    1,
    Number(
        process.argv
            .find((arg) => arg.startsWith("--repeat="))
            ?.slice("--repeat=".length) ?? 1
    )
);

/** Below this, direction is reported as `?` rather than guessed at. */
const MIN_REPEAT_FOR_VERDICT = 3;

const mean = (values: number[]) =>
    values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;

const spread = (values: number[]) => {
    if (values.length === 0) return "n/a";
    if (values.length === 1) return String(values[0]);
    return `${mean(values).toFixed(1)} (${Math.min(...values)}-${Math.max(...values)})`;
};

const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A rate limit is not a result.
 *
 * A full run is 27 sequential generations of a long prompt, which is enough to
 * cross a 30 000 tokens-per-minute account limit partway through — and it did,
 * on the first run of the re-placed scale. Without this the eval dies at
 * generation 21 and reports nothing, so a rate limit costs the twenty
 * generations already paid for AND the answer.
 *
 * Retries only what is worth retrying: a 429 or an explicit
 * `rate_limit_exceeded` is a wait, and anything else is a real failure that
 * should surface immediately rather than be tried four more times. The backoff
 * is generous because the limit being hit is per MINUTE — a 200 ms
 * `retry-after` is the provider's optimism, not a schedule that clears a TPM
 * window.
 */
const RATE_LIMIT_RETRIES = 4;

const isRateLimit = (error: unknown): boolean => {
    const err = error as { status?: number; code?: string } | undefined;
    return err?.status === 429 || err?.code === "rate_limit_exceeded";
};

const generate = async (
    dish: Dish,
    level: Level,
    units: string,
    tags: string
): Promise<{ sample: Sample; lines: Line[] }> => {
    const system = buildRecipeSystemPrompt(units, tags, dish.ingredients);
    const user = buildRecipeUserPrompt(
        dish.name,
        level,
        dish.ingredients,
        dish.servings
    );

    for (let attempt = 0; ; attempt++) {
        try {
            let raw = "";
            // The model the production path names, so what this measures is
            // what the app actually generates.
            for await (const chunk of generateStream({
                model: { openai: "gpt-4.1" },
                label: "eval.difficulty-ladder",
                system,
                user,
            })) {
                raw += chunk.choices[0]?.delta?.content ?? "";
            }

            const lines = parseJsonl(raw);
            return { sample: measure(lines, dish), lines };
        } catch (error) {
            if (!isRateLimit(error) || attempt >= RATE_LIMIT_RETRIES) throw error;

            const waitMs = 20_000 * (attempt + 1);
            console.log(
                `    rate limited — waiting ${waitMs / 1000}s ` +
                    `(attempt ${attempt + 1}/${RATE_LIMIT_RETRIES})`
            );
            await sleep(waitMs);
        }
    }
};

/**
 * Whether a metric rises across the three levels.
 *
 * `rising` requires only that hard exceeds easy — NOT that every adjacent pair
 * increases. Strict monotonicity across three noisy means would report `flat` on
 * a generator that is working, because medium and hard genuinely overlap on a
 * dish with little headroom (the tomato soup). `inverted` is the finding that
 * matters: easy came out more involved than hard.
 */
const direction = (values: number[]): "rising" | "flat" | "inverted" => {
    const [easy, , hard] = values;
    if (hard > easy) return "rising";
    if (hard < easy) return "inverted";
    return "flat";
};

const ARROW = { rising: "up", flat: "flat", inverted: "DOWN" } as const;

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
    const only = onlyArg?.slice("--only=".length).split(",").filter(Boolean);

    const dishes = only
        ? DISHES.filter((dish) =>
              only.some((needle) =>
                  dish.name.toLowerCase().includes(needle.toLowerCase())
              )
          )
        : DISHES;

    if (dishes.length === 0) {
        console.error(
            `No dish matches --only=${only?.join(",")}. Known: ${DISHES.map((d) => d.name).join(", ")}`
        );
        process.exit(1);
    }

    const metadata = await fetchRecipeMetadata();
    const units = formatUnitsForPrompt(metadata.units);
    const tags = formatTagsForPrompt(metadata.tags);

    const captured: unknown[] = [];
    /** dish -> level -> one entry per repeat. */
    const samples = new Map<string, Map<Level, Sample[]>>();
    const identityFailures: string[] = [];

    for (const dish of dishes) {
        console.log(
            `\n=== ${dish.name}${REPEAT > 1 ? ` (${REPEAT} runs per level)` : ""} ===`
        );
        const perLevel = new Map<Level, Sample[]>();

        for (const level of LEVELS) {
            const runs: Sample[] = [];

            for (let run = 0; run < REPEAT; run++) {
                const { sample, lines } = await generate(
                    dish,
                    level,
                    units,
                    tags
                );
                runs.push(sample);
                captured.push({
                    dish: dish.name,
                    level,
                    run: run + 1,
                    sample,
                    lines,
                });

                // Written after EVERY generation, not once at the end. A run
                // that dies at generation 21 of 27 — which a rate limit will
                // do — must not also throw away the twenty already paid for.
                // Rewriting the whole array each time is trivially cheap
                // beside a model call and keeps the file valid JSON at all
                // times, which an append-per-line format would not.
                writeFileSync(
                    join(OUT_DIR, "generations.json"),
                    JSON.stringify(captured, null, 2)
                );

                if (sample.definingMissing.length > 0) {
                    identityFailures.push(
                        `${dish.name} @ ${level}${REPEAT > 1 ? ` [run ${run + 1}]` : ""}` +
                            ` is missing ${sample.definingMissing.join(", ")}`
                    );
                }

                console.log(
                    `    ${level.padEnd(6)}${REPEAT > 1 ? ` [${run + 1}/${REPEAT}]` : ""}` +
                        ` ${String(sample.steps).padStart(2)} steps,` +
                        ` ${String(sample.equipment).padStart(2)} tools,` +
                        ` ${String(sample.technique).padStart(2)} technique,` +
                        ` ${String(sample.minutes).padStart(3)} min` +
                        (sample.definingMissing.length > 0
                            ? `   <-- MISSING ${sample.definingMissing.join(", ")}`
                            : "")
                );
            }

            perLevel.set(level, runs);
        }

        samples.set(dish.name, perLevel);
    }

    // ---- report -------------------------------------------------------------

    console.log("\n\n=== The ladder, read down each dish ===\n");

    const header = [
        "dish".padEnd(26),
        "level".padEnd(7),
        REPEAT > 1 ? "steps".padEnd(14) : "steps",
        "tools",
        " tech",
        "scratch",
        "  min",
        "ident",
    ].join("  ");
    console.log(header);
    console.log("-".repeat(header.length));

    const inverted: string[] = [];

    for (const dish of dishes) {
        const perLevel = samples.get(dish.name);
        if (!perLevel) continue;

        for (const level of LEVELS) {
            const runs = perLevel.get(level) ?? [];
            const missing = runs.some((r) => r.definingMissing.length > 0);

            console.log(
                [
                    (level === "easy" ? dish.name : "").padEnd(26),
                    level.padEnd(7),
                    REPEAT > 1
                        ? spread(runs.map((r) => r.steps)).padEnd(14)
                        : String(runs[0]?.steps ?? 0).padStart(5),
                    mean(runs.map((r) => r.equipment)).toFixed(1).padStart(5),
                    mean(runs.map((r) => r.technique)).toFixed(1).padStart(5),
                    mean(runs.map((r) => r.scratch)).toFixed(1).padStart(7),
                    mean(runs.map((r) => r.minutes)).toFixed(0).padStart(5),
                    (missing ? "FAIL" : "ok").padStart(5),
                ].join("  ")
            );
        }

        const byMetric = (pick: (s: Sample) => number) =>
            LEVELS.map((level) => mean((perLevel.get(level) ?? []).map(pick)));

        const verdicts = {
            steps: direction(byMetric((s) => s.steps)),
            tools: direction(byMetric((s) => s.equipment)),
            tech: direction(byMetric((s) => s.technique)),
        };

        const summary =
            REPEAT < MIN_REPEAT_FOR_VERDICT
                ? "? (needs --repeat=3)"
                : Object.entries(verdicts)
                      .map(([metric, value]) => `${metric} ${ARROW[value]}`)
                      .join(", ");

        console.log(`${"".padEnd(26)}  easy -> hard:  ${summary}\n`);

        if (
            REPEAT >= MIN_REPEAT_FOR_VERDICT &&
            Object.values(verdicts).every((value) => value === "inverted")
        ) {
            inverted.push(dish.name);
        }
    }

    // ---- verdict ------------------------------------------------------------

    console.log(
        `tools / tech are DISTINCT counts per recipe, averaged over runs.` +
            `\ntech counts named advanced techniques only and undercounts by design —` +
            ` read it beside steps and tools, never alone.` +
            `\nident is the assertion: every defining ingredient present at every level.` +
            (REPEAT > 1
                ? `\nsteps is mean (min-max) over ${REPEAT} runs per level.`
                : `\n\n⚠ ONE run per level — the ladder columns are NOISE at this sample size.` +
                  `\n  Identical prompts have spread 6-12 steps. Use --repeat=3 for a direction.`) +
            `\n\nRaw generations: ${join(OUT_DIR, "generations.json")}`
    );

    let failed = false;

    if (identityFailures.length > 0) {
        failed = true;
        console.error(
            `\n\nFAIL — the dish did not survive the climb (${identityFailures.length}):`
        );
        for (const failure of identityFailures) console.error(`  - ${failure}`);
        console.error(
            `\nA defining ingredient is missing from a generated recipe. This is the` +
                `\nGUTTED_DISHES class: the name and the tags stay impeccable, so nothing` +
                `\ndownstream reports it. DIFFICULTY_RULE promises the opposite in words.`
        );
    }

    if (inverted.length > 0) {
        failed = true;
        console.error(
            `\n\nFAIL — the ladder runs backwards on: ${inverted.join(", ")}.` +
                `\nEvery metric came out lower at hard than at easy, over ${REPEAT} runs.` +
                `\nThat is the scale drift this eval was built for — check that the` +
                `\ngenerator is being given DIFFICULTY_RULE and that its rungs still` +
                `\nread in the order they are written.`
        );
    }

    if (failed) process.exit(1);

    console.log("\n\nPASS");
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
