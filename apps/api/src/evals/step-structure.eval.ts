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
 * Two questions about the *data behind* the steps section:
 *
 *  1. Can the generator be made to emit ONE temperature unit? Today nothing in
 *     any prompt mentions units at all, so the model volunteers "180°C (350°F)"
 *     whenever it feels like it, and the step text carries two numbers where the
 *     cook needs one.
 *  2. Can it emit steps as *structured data* rather than an English sentence the
 *     client has to mine with a regex? `parse-durations.ts` already recovers
 *     timings from prose; per-step quantities cannot be recovered at all.
 *
 * Baseline runs the shipped `buildRecipeSystemPrompt` unmodified, so the
 * comparison is against what production actually sends. Each variant appends a
 * rule block to that same prompt.
 */

const OUT_DIR = join(__dirname, "..", "..", "eval-output", "step-structure");

/** Oven, braise and pan dishes — temperature only really bites on the first. */
const DISHES = [
    {
        name: "Roast Chicken with Lemon and Thyme",
        difficulty: "medium",
        servings: 4,
        ingredients: [
            "chicken",
            "lemon",
            "thyme",
            "butter",
            "garlic",
            "olive oil",
            "salt",
            "black pepper",
        ],
    },
    {
        name: "Beef Bourguignon",
        difficulty: "hard",
        servings: 4,
        ingredients: [
            "beef chuck",
            "bacon",
            "red wine",
            "carrot",
            "onion",
            "mushroom",
            "garlic",
            "tomato paste",
            "beef stock",
            "butter",
            "flour",
            "thyme",
        ],
    },
    {
        name: "Lemon Ricotta Pancakes",
        difficulty: "easy",
        servings: 2,
        ingredients: [
            "ricotta",
            "flour",
            "egg",
            "milk",
            "lemon",
            "sugar",
            "baking powder",
            "butter",
        ],
    },
];

const TEMPERATURE_RULES = `
## Temperature Rules
- Write every temperature in Celsius ONLY, as a whole number followed by °C (e.g. "180°C").
- NEVER give a second unit in parentheses. Write "180°C", never "180°C (350°F)", and never "350°F" on its own.
- For a fan/convection oven give the Celsius figure the recipe actually uses; do not append a conversion.`;

const STRUCTURED_FIELDS = `
## Structured Step Fields
Each instruction line MUST also carry these fields alongside "text" and "ingredients":
- "durationSeconds": how long this step takes or waits, in seconds. Use the LOWER bound of a range. Omit only when the step has no meaningful duration.
- "temperatureC": the cooking temperature in Celsius as a whole number, when this step sets or depends on one (oven, oil, water, internal doneness). Omit when no temperature applies.
- "equipment": array of the main tools this step needs, e.g. ["oven","roasting tin"]. Omit if nothing notable.
The "text" MUST still read naturally and still mention the time and temperature in words — these fields are in addition to the sentence, never a replacement for it.`;

const STEP_QUANTITIES = `
## Per-step Quantities
Alongside "ingredients" (names), each instruction line MUST carry "stepIngredients":
an array of {"name":"butter","quantity":30,"unit":"g"} naming what the step uses and how much.
The quantities for an ingredient across all steps MUST sum to the total declared for it in the
ingredient list. Use the same unit abbreviations as the ingredient list.`;

/**
 * The sum framing above fails in a specific way: the model repeats the ingredient's
 * FULL amount in every step that mentions it (900 g of beef in each of five steps),
 * so the totals inflate by the number of mentions. It reads the instruction as
 * "which ingredient is this?" rather than "how much of it goes in here?".
 *
 * This reframes it as splitting a fixed budget, and names the repeat as the error
 * to avoid rather than stating the invariant the model is supposed to infer.
 */
const STEP_QUANTITIES_SPLIT = `
## Per-step Quantities
Alongside "ingredients" (names), each instruction line MUST carry "stepIngredients":
an array of {"name":"butter","quantity":30,"unit":"g"} naming what the step uses and how much.

Think of each ingredient's declared amount as a budget that is spent across the steps:
- If an ingredient is used in ONE step, that step takes its whole declared amount.
- If it is used in SEVERAL steps, SPLIT the amount between them so the parts add up to the
  declared total — e.g. 60 g butter declared, used twice, becomes 40 g in one step and 20 g in the other.
- NEVER repeat the full declared amount in more than one step. Listing 900 g of beef in five
  different steps would mean 4500 g of beef, which is wrong.
- Use the same unit abbreviations as the ingredient list.`;

const VARIANTS: Record<string, string> = {
    baseline: "",
    a_units: TEMPERATURE_RULES,
    b_structured: TEMPERATURE_RULES + STRUCTURED_FIELDS,
    c_quantities: TEMPERATURE_RULES + STRUCTURED_FIELDS + STEP_QUANTITIES,
    d_split: TEMPERATURE_RULES + STRUCTURED_FIELDS + STEP_QUANTITIES_SPLIT,
};

interface StepLine {
    type?: string;
    text?: string;
    ingredients?: string[];
    durationSeconds?: number;
    temperatureC?: number;
    equipment?: string[];
    stepIngredients?: { name?: string; quantity?: number; unit?: string }[];
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

// Deliberately loose — this is measuring what the model wrote in prose, so it
// has to catch the sloppy forms too ("180 C", "350 degrees F").
const CELSIUS_RE = /\d+\s*(?:°\s*C\b|degrees?\s*C(?:elsius)?\b|\bC\b(?=\s|$|\.|,))/i;
const FAHRENHEIT_RE = /\d+\s*(?:°\s*F\b|degrees?\s*F(?:ahrenheit)?\b)/i;
const DURATION_RE =
    /\b\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i;

interface Score {
    steps: number;
    /** The reported bug: both units in one step. */
    dualUnit: number;
    /** Fahrenheit anywhere, with or without Celsius. */
    anyFahrenheit: number;
    celsiusOnly: number;
    /** Steps whose prose states a duration. */
    proseDuration: number;
    /** ...of those, how many also carry the structured field. */
    durationField: number;
    proseTemperature: number;
    temperatureField: number;
    equipmentField: number;
    stepIngredientsField: number;
    /** stepIngredients entries missing a quantity or unit. */
    incompleteQuantities: number;
    /**
     * Ingredients whose per-step quantities do not add up to the amount declared
     * in the ingredient list. The one metric that matters for quantities, and the
     * one a presence check misses entirely: well-formed numbers can still be the
     * full amount repeated in every step.
     */
    quantitySumMismatch: number;
    /** Ingredients checked for the above (i.e. those appearing in any step). */
    quantitySumChecked: number;
}

const emptyScore = (): Score => ({
    steps: 0,
    dualUnit: 0,
    anyFahrenheit: 0,
    celsiusOnly: 0,
    proseDuration: 0,
    durationField: 0,
    proseTemperature: 0,
    temperatureField: 0,
    equipmentField: 0,
    stepIngredientsField: 0,
    incompleteQuantities: 0,
    quantitySumMismatch: 0,
    quantitySumChecked: 0,
});

interface IngredientLine {
    name?: string;
    quantity?: number;
    unit?: string;
}

/**
 * Compares the sum of each ingredient's per-step quantities against the amount
 * declared in the ingredient list, and records the discrepancies by name so the
 * failure mode is legible rather than just a count.
 */
const scoreQuantitySums = (
    ingredients: IngredientLine[],
    steps: StepLine[],
    into: Score
): { name: string; declared: string; summed: string }[] => {
    const declared = new Map<string, IngredientLine>();
    for (const item of ingredients) {
        if (item.name) declared.set(item.name.toLowerCase().trim(), item);
    }

    const summed = new Map<string, { quantity: number; unit?: string }>();
    for (const step of steps) {
        for (const item of step.stepIngredients ?? []) {
            const key = (item.name ?? "").toLowerCase().trim();
            if (!key) continue;
            const entry = summed.get(key) ?? { quantity: 0, unit: item.unit };
            entry.quantity += item.quantity ?? 0;
            summed.set(key, entry);
        }
    }

    const mismatches = [];
    for (const [key, total] of summed) {
        const target = declared.get(key);
        // An ingredient the steps invented isn't a *sum* failure; leave it out
        // rather than let it inflate this metric.
        if (!target || typeof target.quantity !== "number") continue;

        into.quantitySumChecked += 1;
        const unitsAgree = (total.unit ?? "") === (target.unit ?? "");
        if (!unitsAgree || Math.abs(total.quantity - target.quantity) > 0.01) {
            into.quantitySumMismatch += 1;
            mismatches.push({
                name: key,
                declared: `${target.quantity}${target.unit ?? ""}`,
                summed: `${total.quantity}${total.unit ?? ""}`,
            });
        }
    }

    return mismatches;
};

const scoreSteps = (steps: StepLine[], into: Score): Score => {
    for (const step of steps) {
        const text = step.text ?? "";
        into.steps += 1;

        const hasC = CELSIUS_RE.test(text);
        const hasF = FAHRENHEIT_RE.test(text);
        if (hasC && hasF) into.dualUnit += 1;
        if (hasF) into.anyFahrenheit += 1;
        if (hasC && !hasF) into.celsiusOnly += 1;

        if (DURATION_RE.test(text)) {
            into.proseDuration += 1;
            if (typeof step.durationSeconds === "number") {
                into.durationField += 1;
            }
        }

        if (hasC || hasF) {
            into.proseTemperature += 1;
            if (typeof step.temperatureC === "number") {
                into.temperatureField += 1;
            }
        }

        if (Array.isArray(step.equipment) && step.equipment.length > 0) {
            into.equipmentField += 1;
        }

        if (Array.isArray(step.stepIngredients)) {
            into.stepIngredientsField += 1;
            for (const item of step.stepIngredients) {
                if (typeof item.quantity !== "number" || !item.unit) {
                    into.incompleteQuantities += 1;
                }
            }
        }
    }

    return into;
};

const pct = (part: number, whole: number) =>
    whole === 0 ? "  n/a" : `${((part / whole) * 100).toFixed(0).padStart(4)}%`;

async function runVariant(
    variant: string,
    extraRules: string,
    units: string,
    tags: string
) {
    const score = emptyScore();
    const captured = [];

    for (const dish of DISHES) {
        const system =
            buildRecipeSystemPrompt(units, tags, dish.ingredients) + extraRules;
        const user = buildRecipeUserPrompt(
            dish.name,
            dish.difficulty,
            dish.ingredients,
            dish.servings
        );

        let raw = "";
        // Same model the production path names, so the variants are measured
        // against what actually generates recipes today.
        for await (const chunk of generateStream({
            model: { openai: "gpt-4.1" },
            system,
            user,
        })) {
            raw += chunk.choices[0]?.delta?.content ?? "";
        }

        const lines = parseJsonl(raw);
        const steps = lines.filter((line) => line.type === "instruction");
        const ingredients = lines.filter((line) => line.type === "ingredient");
        scoreSteps(steps, score);
        const mismatches = scoreQuantitySums(
            ingredients as IngredientLine[],
            steps,
            score
        );

        captured.push({
            dish: dish.name,
            ingredients,
            steps,
            quantityMismatches: mismatches,
        });

        console.log(
            `    ${dish.name}: ${steps.length} steps` +
                (mismatches.length
                    ? `, ${mismatches.length} quantity mismatches ` +
                      `(e.g. ${mismatches[0].name} ${mismatches[0].declared} → ${mismatches[0].summed})`
                    : "")
        );
    }

    writeFileSync(
        join(OUT_DIR, `${variant}.json`),
        JSON.stringify(captured, null, 2)
    );

    return score;
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const metadata = await fetchRecipeMetadata();
    const units = formatUnitsForPrompt(metadata.units);
    const tags = formatTagsForPrompt(metadata.tags);

    const scores: Record<string, Score> = {};

    // `--only=d_split,c_quantities` re-runs a subset. Each full pass is a dozen
    // gpt-4.1 recipe generations, so iterating on one variant shouldn't pay for
    // the ones already measured.
    const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
    const only = onlyArg?.slice("--only=".length).split(",").filter(Boolean);

    for (const [variant, rules] of Object.entries(VARIANTS)) {
        if (only && !only.includes(variant)) continue;
        console.log(`\n=== ${variant} ===`);
        scores[variant] = await runVariant(variant, rules, units, tags);
    }

    console.log("\n\n=== Results ===\n");
    const header = [
        "variant".padEnd(14),
        "steps",
        " dual°",
        "  any°F",
        "dur.fld",
        "tmp.fld",
        "equip",
        "qty.stp",
        "sum.ok",
    ].join("  ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const [variant, s] of Object.entries(scores)) {
        console.log(
            [
                variant.padEnd(14),
                String(s.steps).padStart(5),
                String(s.dualUnit).padStart(6),
                String(s.anyFahrenheit).padStart(7),
                pct(s.durationField, s.proseDuration).padStart(7),
                pct(s.temperatureField, s.proseTemperature).padStart(7),
                String(s.equipmentField).padStart(5),
                String(s.stepIngredientsField).padStart(7),
                pct(
                    s.quantitySumChecked - s.quantitySumMismatch,
                    s.quantitySumChecked
                ).padStart(7),
            ].join("  ")
        );
    }

    console.log(
        `\ndual° / any°F are step counts (lower is better).` +
            `\ndur.fld / tmp.fld are coverage: of the steps whose prose states one,` +
            ` how many carry the structured field.` +
            `\n\nRaw generations: ${OUT_DIR}`
    );
}

main().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
});
