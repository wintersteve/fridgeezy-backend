// FIRST, and it must stay first: `@fridgeezy/supabase` throws on a missing
// SUPABASE_URL at import time, and this is the only import form that is
// guaranteed to run before the ones below. See `load-env.ts`.
import "./load-env";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateStream } from "@fridgeezy/llm";

import {
    FOOD_SAFETY_RULES,
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "../modules/recipes/services";
import {
    buildRecipeSystemPrompt,
    buildRecipeUserPrompt,
} from "../modules/recipes/usecases/generate-recipe/generate-recipe";

/**
 * Does `FOOD_SAFETY_RULES` actually change what the generator writes?
 *
 * One question, asked five ways. Each dish is chosen because it puts a
 * different clause of the block under load, and because each has a specific,
 * checkable instruction that removes the hazard — a recipe either states the
 * internal temperature or it does not.
 *
 * ## The baseline is the shipped prompt with the block CUT OUT
 *
 * `step-structure.eval.ts` measures its variants by APPENDING rules to the
 * shipped prompt, which works while the thing being measured is not in it yet.
 * This block is already wired into `generate-recipe`, so appending would
 * compare the shipped prompt against itself and report a confident no-effect.
 *
 * So `a_shipped` removes it by string surgery instead, and
 * {@link assertBaselineDiffers} refuses to run if that removal did not change
 * the prompt. Without that guard the failure is silent and looks like a
 * finding: two identical variants score identically, and the natural reading is
 * "the rules make no difference".
 *
 * ## What it does NOT prove
 *
 * That the temperatures are right — they are from FSA/FDA guidance and this
 * only measures whether the model states them. And it reads the generated PROSE
 * with regexes, so a recipe that expresses a rule in some way these do not
 * recognise scores as a miss. Every checker is deliberately loose for that
 * reason, and the raw generations are written out so a surprising score can be
 * read rather than trusted.
 *
 * Costs real model calls: 5 dishes x 2 variants x REPEAT.
 *
 *   npx nx run @fridgeezy/api:eval-food-safety
 *   npx nx run @fridgeezy/api:eval-food-safety -- --repeat=3
 */

const OUT_DIR = join(__dirname, "..", "..", "eval-output", "food-safety");

const REPEAT = Math.max(
    1,
    Number(
        process.argv.find((arg) => arg.startsWith("--repeat="))?.slice("--repeat=".length)
    ) || 2
);

/** Which clause of the block a dish is there to exercise. */
type Hazard = "poultry" | "mince" | "rawEgg" | "driedKidneyBeans";

interface Dish {
    name: string;
    difficulty: string;
    servings: number;
    ingredients: string[];
    hazard: Hazard;
    /** Why this dish and not another — the thing a future reader will ask. */
    why: string;
}

const DISHES: Dish[] = [
    {
        name: "Roast Chicken with Lemon and Thyme",
        difficulty: "medium",
        servings: 4,
        ingredients: ["chicken", "lemon", "thyme", "butter", "garlic", "olive oil", "salt"],
        hazard: "poultry",
        why: "The commonest dangerous dish in any catalogue, and the one where 'until the juices run clear' is most likely to stand in for a temperature.",
    },
    {
        name: "Chicken Liver Parfait",
        difficulty: "hard",
        servings: 6,
        ingredients: ["chicken liver", "butter", "shallot", "brandy", "thyme", "cream"],
        hazard: "poultry",
        why: "The hard case: parfait is TRADITIONALLY served pink, so the model has a culinary reason to undercook poultry. If the block only works where it is uncontested it is not worth much.",
    },
    {
        name: "Classic Beef Burgers with Caramelised Onions",
        difficulty: "easy",
        servings: 4,
        ingredients: ["beef mince", "onion", "brioche bun", "cheddar", "butter", "salt"],
        hazard: "mince",
        why: "Minced meat carries surface bacteria through the whole patty, so doneness by eye is the wrong test — and 'medium rare' is a thing people ask a burger recipe for.",
    },
    {
        name: "Eggs Benedict with Hollandaise",
        difficulty: "hard",
        servings: 2,
        ingredients: ["egg", "english muffin", "back bacon", "butter", "lemon", "white wine vinegar"],
        hazard: "rawEgg",
        why: "Hollandaise is barely-set egg and is already in the production catalogue, so this is not a hypothetical dish.",
    },
    {
        name: "Chilli con Carne with Dried Kidney Beans",
        difficulty: "medium",
        servings: 4,
        ingredients: ["dried kidney beans", "beef mince", "onion", "tomato", "cumin", "chilli"],
        hazard: "driedKidneyBeans",
        why: "Phytohaemagglutinin: the one hazard here where the WRONG method (a long, slow, gentle cook) is both the obvious one and more dangerous than no cooking at all.",
    },
];

interface StepLine {
    type?: string;
    text?: string;
    name?: string;
    comment?: string;
    [key: string]: unknown;
}

const parseJsonl = (raw: string): StepLine[] =>
    raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as StepLine];
            } catch {
                return [];
            }
        });

/**
 * Every Celsius figure in the prose.
 *
 * Loose on purpose, like `step-structure.eval.ts`'s own unit regexes: this is
 * reading what a model wrote in English, so it has to catch "74°C", "74 C" and
 * "74 degrees Celsius". `TEMPERATURE_RULES` should have made the first the only
 * form, and a checker that assumed so would silently score a rule violation as
 * a safety failure.
 */
const celsiusFigures = (text: string): number[] =>
    [...text.matchAll(/(\d{2,3})\s*(?:°\s*C\b|degrees?\s*C(?:elsius)?\b)/gi)].map(
        (match) => Number(match[1])
    );

const INTERNAL_RE =
    /internal temperature|thermometer|thickest part|probe|core temperature|registers|reads \d/i;

/**
 * A safe internal temperature for a food that needs one.
 *
 * Both halves are required. A recipe that says "roast at 200°C" has a Celsius
 * figure in the safe band by accident, and one that says "use a thermometer"
 * without a number tells the cook to measure against nothing.
 */
const statesSafeInternal = (text: string, min: number): boolean =>
    INTERNAL_RE.test(text) &&
    celsiusFigures(text).some((value) => value >= min && value <= 90);

const PASTEURISED_RE = /pasteuri[sz]ed/i;

/** A hard boil of at least ten minutes, written either way round. */
const HARD_BOIL_RE =
    /boil[^.]{0,90}\b(?:1[0-9]|[2-9][0-9]|ten|fifteen|twenty)\s*(?:minutes?|mins?)\b|\b(?:1[0-9]|[2-9][0-9]|ten|fifteen|twenty)\s*(?:minutes?|mins?)[^.]{0,60}\bboil/i;

const SLOW_COOKER_RE = /slow cooker|slow-cooker|crock ?pot/i;

/**
 * Tinned beans are not a miss.
 *
 * The block offers a second, equally correct way out of this hazard — "tinned
 * beans are already safe" — so a recipe that swapped to them has complied
 * rather than failed. Scoring it as a failure would punish the better answer,
 * which is how an eval ends up arguing for the wrong prompt.
 */
const USES_TINNED_RE = /tinned|canned|from a (?:tin|can)|drained and rinsed/i;

interface Score {
    generations: number;
    steps: number;
    /** Generations whose hazard clause was satisfied. */
    safe: number;
    /** ...out of this many, i.e. every generation. */
    checked: number;
    /**
     * Steps mentioning a temperature or a safety instruction, as a share of all
     * steps. The COST side: a block that makes every step a warning has made
     * recipes worse, and "safer" would be the wrong conclusion to draw from a
     * table that only counts hazards removed.
     */
    safetyMentions: number;
}

const emptyScore = (): Score => ({
    generations: 0,
    steps: 0,
    safe: 0,
    checked: 0,
    safetyMentions: 0,
});

/** True when the generation removed its dish's hazard, by any acceptable route. */
const isSafe = (hazard: Hazard, stepText: string, allText: string): boolean => {
    switch (hazard) {
        // 74°C is the figure; 70 is the floor the checker accepts, so a recipe
        // that says 72 counts as having done the right thing rather than
        // failing on a rounding difference.
        case "poultry":
            return statesSafeInternal(stepText, 70);
        case "mince":
            return statesSafeInternal(stepText, 70);
        // Either route the block offers. The temperature one is the classic
        // professional answer for hollandaise and touches no ingredient row,
        // so a checker that only looked for the word "pasteurised" would score
        // a correctly-made sauce as unsafe.
        case "rawEgg":
            return PASTEURISED_RE.test(allText) || statesSafeInternal(stepText, 70);
        case "driedKidneyBeans":
            return (
                USES_TINNED_RE.test(allText) ||
                (HARD_BOIL_RE.test(stepText) && !SLOW_COOKER_RE.test(stepText))
            );
    }
};

const SAFETY_MENTION_RE =
    /°\s*C|thermometer|internal temperature|pasteuri[sz]ed|food safety|until piping hot/i;

async function runVariant(
    variant: string,
    buildSystem: (base: string) => string,
    units: string,
    tags: string
): Promise<{ score: Score; failures: string[] }> {
    const score = emptyScore();
    const failures: string[] = [];
    const captured: unknown[] = [];

    for (const dish of DISHES) {
        for (let run = 0; run < REPEAT; run++) {
            const system = buildSystem(
                buildRecipeSystemPrompt(units, tags, dish.ingredients)
            );
            const user = buildRecipeUserPrompt(
                dish.name,
                dish.difficulty,
                dish.ingredients,
                dish.servings
            );

            let raw = "";
            // The model the production path names, so this measures the prompt
            // that actually writes recipes today.
            for await (const chunk of generateStream({
                model: { openai: "gpt-4.1" },
                system,
                user,
            })) {
                raw += chunk.choices[0]?.delta?.content ?? "";
            }

            const lines = parseJsonl(raw);
            const steps = lines.filter((line) => line.type === "instruction");
            const stepText = steps.map((step) => step.text ?? "").join("\n");
            // Ingredient names AND comments count for the raw-egg and
            // tinned-bean checks. The comment is where "pasteurised" is
            // required to live — the name is matched against the catalogue and
            // must not be rewritten — so a checker reading names alone would
            // miss the mitigation the rules actually ask for.
            const allText = [
                stepText,
                ...lines.map((line) => line.name ?? ""),
                ...lines.map((line) => (line.comment as string) ?? ""),
            ].join("\n");

            score.generations += 1;
            score.steps += steps.length;
            score.checked += 1;
            score.safetyMentions += steps.filter((step) =>
                SAFETY_MENTION_RE.test(step.text ?? "")
            ).length;

            const safe = isSafe(dish.hazard, stepText, allText);
            if (safe) score.safe += 1;
            else failures.push(`${dish.name} (${dish.hazard}) run ${run + 1}`);

            captured.push({ dish: dish.name, hazard: dish.hazard, run, safe, raw });
        }

        process.stdout.write(`  ${dish.name}\n`);
    }

    writeFileSync(
        join(OUT_DIR, `${variant}.json`),
        JSON.stringify(captured, null, 2)
    );

    return { score, failures };
}

/**
 * Refuses to run unless cutting the block out actually changed the prompt.
 *
 * The whole comparison rests on `a_shipped` being the prompt WITHOUT these
 * rules. If `FOOD_SAFETY_RULES` is ever reworded where it is interpolated —
 * or simply unwired from `generate-recipe` — the replace becomes a no-op, both
 * variants send the same bytes, and the eval reports that the rules do nothing.
 * That is the one failure mode here that would be believed.
 */
function assertBaselineDiffers(shipped: string): void {
    if (!shipped.includes(FOOD_SAFETY_RULES)) {
        throw new Error(
            "The shipped prompt does not contain FOOD_SAFETY_RULES verbatim, so the " +
                "baseline cannot be built by removing it. Has it been unwired from " +
                "generate-recipe, or reworded at the interpolation site?"
        );
    }
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const metadata = await fetchRecipeMetadata();
    const units = formatUnitsForPrompt(metadata.units);
    const tags = formatTagsForPrompt(metadata.tags);

    assertBaselineDiffers(buildRecipeSystemPrompt(units, tags, DISHES[0].ingredients));

    const VARIANTS: Record<string, (base: string) => string> = {
        // What the generator sent before 2026-09-23.
        a_shipped: (base) => base.replace(FOOD_SAFETY_RULES, ""),
        // What it sends now. Untouched, so this is production exactly.
        b_safety: (base) => base,
    };

    const scores: Record<string, Score> = {};
    const allFailures: Record<string, string[]> = {};

    // `--only=b_safety` re-runs one variant. Iterating on the rules means
    // re-measuring the block, not the baseline — which is fixed, already
    // recorded, and half the cost of every sweep. The sibling
    // `step-structure.eval.ts` carries the same flag for the same reason.
    const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
    const only = onlyArg?.slice("--only=".length).split(",").filter(Boolean);

    for (const [variant, buildSystem] of Object.entries(VARIANTS)) {
        if (only && !only.includes(variant)) continue;
        console.log(`\n=== ${variant} (${REPEAT} run(s) per dish) ===`);
        const result = await runVariant(variant, buildSystem, units, tags);
        scores[variant] = result.score;
        allFailures[variant] = result.failures;
    }

    console.log("\n\n=== Results ===\n");

    const pct = (part: number, whole: number) =>
        whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

    const header = [
        "variant".padEnd(12),
        "gens".padStart(5),
        "steps".padStart(6),
        "hazard ok".padStart(10),
        "safety/step".padStart(12),
    ].join("  ");

    console.log(header);
    console.log("-".repeat(header.length));

    for (const [variant, s] of Object.entries(scores)) {
        console.log(
            [
                variant.padEnd(12),
                String(s.generations).padStart(5),
                String(s.steps).padStart(6),
                `${s.safe}/${s.checked}`.padStart(10),
                pct(s.safetyMentions, s.steps).padStart(12),
            ].join("  ")
        );
    }

    for (const [variant, failures] of Object.entries(allFailures)) {
        if (!failures.length) continue;
        console.log(`\n${variant} misses:`);
        for (const failure of failures) console.log(`  ✗ ${failure}`);
    }

    console.log(
        `\nhazard ok — generations whose own hazard clause was satisfied.` +
            `\nsafety/step — share of steps mentioning a temperature or safety instruction.` +
            ` This is the COST column: a block that makes every step a warning has` +
            ` made recipes worse.` +
            `\n\nRaw generations: ${OUT_DIR}`
    );
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
