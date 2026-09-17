// Must be the first import — the Supabase client throws on a missing
// SUPABASE_URL at *import* time, before any statement in this file would run.
import "dotenv/config";

import { generateStream } from "@fridgeezy/llm";
import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { z } from "zod/v4";

import {
    buildPairingPrompts,
    PAIRING_COURSES,
} from "../modules/recipes/services/generate-dish-pairings";

/**
 * Does the pairing prompt know when a dish wants nothing beside it?
 *
 *   npx nx run @fridgeezy/api:eval-dish-pairings
 *
 * The whole feature turns on one judgement the model makes in a single line:
 * which of appetizer, side and dessert are worth serving with this dish. The
 * picker used to draw all three rows for everything, which is three invitations
 * to add something that does not belong — and the fix is only a fix if the
 * model will actually say "none" for a dish that is eaten alone.
 *
 * **More than half the cases below assert a course is NOT endorsed**, which is
 * the half with no visible failure: an over-endorsed course looks exactly like
 * a working app to anybody who has not thought about what they are being
 * offered. A one-pot ribollita with a side of roast potatoes is not an error
 * message, it is just wrong.
 *
 * It measures the COURSES line and only that line. Nothing is persisted, no
 * suggestion is written, no dish is reviewed — the stream is abandoned after
 * the first object. So it costs a few hundred tokens per case and can be run
 * on any prompt change.
 *
 * `must` is what the dish genuinely wants; `mustNot` is what it must not be
 * offered. Both are optional — a case asserting only `mustNot` is the common
 * shape here, because the interesting failures are all over-endorsement.
 */
interface Case {
    dish: GenerateRecipeResponseDto;
    must?: string[];
    mustNot?: string[];
    why: string;
}

/** Everything a case does not care about. The prompt reads five fields. */
const dish = (
    name: string,
    description: string,
    ingredients: string[],
    tags: string[],
    difficulty: "easy" | "medium" | "hard" = "medium"
): GenerateRecipeResponseDto => ({
    id: "00000000-0000-0000-0000-000000000000",
    name,
    description,
    difficulty,
    servings: 4,
    prepTime: 15,
    cookTime: 30,
    kcal: 500,
    carbs: 50,
    protein: 20,
    fat: 20,
    ingredients: ingredients.map((ingredient) => ({
        name: ingredient,
        quantity: 1,
        unit: "piece",
    })) as GenerateRecipeResponseDto["ingredients"],
    instructions: [],
    tips: null,
    tags,
});

const CASES: Case[] = [
    {
        dish: dish(
            "Ribollita",
            "A thick Tuscan bread and vegetable soup, simmered with cannellini beans and cavolo nero until it can stand a spoon up.",
            ["cavolo nero", "cannellini bean", "stale bread", "tomato", "olive oil"],
            ["italian", "main", "soup"]
        ),
        mustNot: ["side"],
        why: "A bread-and-bean soup IS the starch and the vegetable. A side is the thing the old course-and-cuisine filter offered most confidently and least usefully.",
    },
    {
        dish: dish(
            "Croque Monsieur",
            "A grilled ham and cheese sandwich under a blanket of béchamel, browned in the oven.",
            ["bread", "ham", "gruyère", "béchamel", "butter"],
            ["french", "main", "sandwich"],
            "easy"
        ),
        mustNot: ["appetizer"],
        why: "A laden sandwich is a whole lunch. Putting a starter in front of it is the conventional answer rather than the correct one.",
    },
    {
        dish: dish(
            "Tiramisu",
            "Coffee-soaked savoiardi layered with sweetened mascarpone and dusted with cocoa.",
            ["mascarpone", "savoiardi", "espresso", "egg", "cocoa"],
            ["italian", "dessert"],
            "easy"
        ),
        mustNot: ["dessert"],
        why: "The dish IS the dessert. Endorsing a second one is the clearest possible case of endorsing a course out of habit.",
    },
    {
        dish: dish(
            "Roast Chicken",
            "A whole chicken roasted with lemon and thyme until the skin is crisp and the juices run clear.",
            ["chicken", "lemon", "thyme", "butter", "garlic"],
            ["british", "main", "roast"]
        ),
        must: ["side"],
        why: "A plain roast is the case a side genuinely belongs to — and the one that proves this is not simply a prompt that refuses everything.",
    },
    {
        dish: dish(
            "Bouillabaisse",
            "The Marseille fish stew: rockfish and shellfish in a saffron and fennel broth, served with rouille and toasted bread.",
            ["rockfish", "mussel", "saffron", "fennel", "tomato"],
            ["french", "main", "stew"],
            "hard"
        ),
        must: ["dessert"],
        mustNot: ["side"],
        why: "A formal French fish stew earns a dessert and comes with its own bread and rouille. Both halves in one case, because the prompt has to discriminate rather than lean one way.",
    },
    {
        dish: dish(
            "Cacio e Pepe",
            "Roman pasta dressed in nothing but pecorino, black pepper and starchy pasta water.",
            ["tonnarelli", "pecorino romano", "black pepper"],
            ["italian", "main", "pasta"],
            "easy"
        ),
        mustNot: ["side"],
        why: "A pasta main takes an antipasto or a dolce, never a side — and a side of anything starchy is exactly what a cuisine filter would have offered.",
    },
    {
        dish: dish(
            "Avocado Toast",
            "Smashed avocado on toasted sourdough with lemon, chilli flakes and olive oil.",
            ["avocado", "sourdough", "lemon", "chilli flake"],
            ["american", "main", "sandwich"],
            "easy"
        ),
        mustNot: ["appetizer", "dessert"],
        why: "A breakfast plate is not a dinner to build three courses around. The endorsement has to read the OCCASION, not just the course tag.",
    },
];

const CoursesSchema = z.object({ courses: z.array(z.string()) });

/**
 * The first JSONL object off the real prompt, then stop.
 *
 * Imported rather than copied: a local paraphrase of the prompt is an eval that
 * passes while the shipped prompt regresses, which is worse than no eval. The
 * module is imported for its rules and the stream is built here so nothing is
 * persisted — `generateDishPairings` itself would review and store every dish.
 */
async function endorsedCourses(subject: GenerateRecipeResponseDto): Promise<string[] | null> {
    const prompts = await buildPairingPrompts(subject);

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "eval.pairings",
        system: prompts.system,
        user: prompts.user,
    });

    for await (const { parsed, schemaIndex } of processJsonlStream(stream, [
        CoursesSchema,
    ])) {
        if (schemaIndex !== 0) continue;

        return (parsed as z.infer<typeof CoursesSchema>).courses
            .map((course) => course.trim().toLowerCase())
            .filter((course) =>
                (PAIRING_COURSES as readonly string[]).includes(course)
            );
    }

    return null;
}

async function main() {
    const repeats = Number(process.env.REPEAT ?? 1);

    let failures = 0;
    let total = 0;

    for (const testCase of CASES) {
        for (let run = 0; run < repeats; run++) {
            total++;

            const courses = await endorsedCourses(testCase.dish);

            if (courses === null) {
                failures++;
                console.log(
                    `✗ ${testCase.dish.name}\n    -> no courses line at all\n    ${testCase.why}`
                );
                continue;
            }

            const missing = (testCase.must ?? []).filter(
                (course) => !courses.includes(course)
            );
            const offered = (testCase.mustNot ?? []).filter((course) =>
                courses.includes(course)
            );

            const ok = missing.length === 0 && offered.length === 0;
            if (!ok) failures++;

            const problems = [
                missing.length ? `missing ${missing.join(", ")}` : "",
                offered.length ? `wrongly offered ${offered.join(", ")}` : "",
            ]
                .filter(Boolean)
                .join("; ");

            console.log(
                `${ok ? "✓" : "✗"} ${testCase.dish.name}  -> [${courses.join(", ")}]${
                    ok ? "" : `\n    ${problems}\n    ${testCase.why}`
                }`
            );
        }
    }

    console.log(`\n${total - failures}/${total} correct`);

    // A non-zero exit so this can gate a prompt change, not just narrate one.
    if (failures > 0) process.exitCode = 1;
}

main();
