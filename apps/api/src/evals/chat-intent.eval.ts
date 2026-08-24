// Must be the first import — the Supabase client throws on a missing
// SUPABASE_URL at *import* time, before any statement in this file would run.
import "dotenv/config";

import { GenerateRecipeResponseDto } from "@fridgeezy/schemas";

import { createChatCompletion } from "../modules/chat/services";
import { buildRecipeChatPrompt } from "../modules/recipes/usecases/recipe-chat/recipe-chat";

/**
 * Does the recipe chat know when a change makes a DIFFERENT DISH?
 *
 *   npx nx run @fridgeezy/api:eval-chat-intent
 *
 * The whole `NEWDISH` intent rests on one judgement the model has to make in a
 * single line: adding cheese to a béchamel gives a Mornay — a dish with its own
 * name, its own recipe, its own place in the catalogue — while adding chilli to
 * it gives a spicier béchamel and nothing more. Get it wrong in one direction
 * and a version of the dish is written under a name nobody uses; wrong in the
 * other and the app is back to the bug this replaced, where the Mornay was
 * persisted as a hidden variant still called *Béchamel*.
 *
 * So this measures the classifier and only the classifier: the real system
 * prompt, one user turn, and the first line back. Nothing is generated, nothing
 * is persisted, no suggestion is written — each case is one short chat call.
 *
 * `expect` is what the line must START with. `null` means the turn is a
 * QUESTION and must be answered in prose — a sentinel there is the most
 * expensive failure of the three, because it turns an answer into an offer to
 * spend money.
 */
type Expectation = "NEWDISH" | "MODIFY" | "DIFFICULTY" | null;

interface Case {
    message: string;
    expect: Expectation;
    /**
     * The dish's name, lowercased, which the line must contain.
     *
     * Checked on BOTH kinds of case, and that is the point on a prose one: an
     * answer to "what happens if I add cheese" is only useful if it says
     * "Mornay". The classifier being right about it being a question does not
     * help if the answer then withholds the one word the reader wanted.
     */
    dish?: string;
    why: string;
}

/** The classic derivation case, and the one the feature was reported against. */
const BECHAMEL: GenerateRecipeResponseDto = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Béchamel",
    description:
        "The French mother sauce: milk thickened with a white roux and seasoned with nutmeg.",
    difficulty: "easy",
    servings: 4,
    prepTime: 5,
    cookTime: 15,
    kcal: 180,
    carbs: 12,
    protein: 5,
    fat: 12,
    ingredients: [
        { name: "butter", quantity: 50, unit: "g", category: "dairy" },
        { name: "plain flour", quantity: 50, unit: "g", category: "grain" },
        { name: "whole milk", quantity: 500, unit: "ml", category: "dairy" },
        { name: "nutmeg", quantity: 1, unit: "pinch", category: "spice" },
    ] as GenerateRecipeResponseDto["ingredients"],
    instructions: [
        { title: "Make the roux", text: "Melt the butter, stir in the flour and cook for two minutes without colouring." },
        { title: "Add the milk", text: "Whisk in the milk a little at a time until smooth." },
        { title: "Thicken", text: "Simmer gently until it coats the back of a spoon, then season with salt and nutmeg." },
    ] as GenerateRecipeResponseDto["instructions"],
    tips: null,
    tags: ["french", "sauce"],
};

const CASES: Case[] = [
    // --- NEWDISH: the change has a name of its own -----------------------
    {
        message: "can you add cheese to this?",
        expect: "NEWDISH",
        dish: "mornay",
        why: "béchamel + cheese is a Mornay — the reported case",
    },
    {
        message: "stir in some gruyère and parmesan",
        expect: "NEWDISH",
        dish: "mornay",
        why: "a request that never says 'cheese' or 'mornay' — the derivation has to be recognised from the ingredients",
    },
    {
        message: "turn this into a mornay sauce",
        expect: "NEWDISH",
        dish: "mornay",
        why: "the user names the target dish themselves",
    },
    {
        message: "add sautéed onion and a bay leaf to make it a soubise",
        expect: "NEWDISH",
        dish: "soubise",
        why: "a second derivation, to check it is not a hardcoded Mornay",
    },

    // --- MODIFY: a version of the same dish -------------------------------
    {
        message: "can you make it dairy free?",
        expect: "MODIFY",
        why: "a dairy-free béchamel is still a béchamel",
    },
    {
        message: "make it with olive oil instead of butter",
        expect: "MODIFY",
        why: "a substitution, not a new dish",
    },
    {
        message: "add some chilli flakes to it",
        expect: "MODIFY",
        why: "the trap: an ADDITION whose result has no name of its own",
    },
    {
        message: "make it gluten free",
        expect: "MODIFY",
        why: "a dietary adaptation is almost never a new dish",
    },

    // --- DIFFICULTY -------------------------------------------------------
    {
        message: "can you make this more of a challenge?",
        expect: "DIFFICULTY",
        why: "about the level of effort, not the ingredients",
    },

    // --- Questions: prose, never a sentinel --------------------------------
    {
        message: "what happens if I add cheese to this?",
        expect: null,
        dish: "mornay",
        why: "the sharpest pair in the set: one word away from the NEWDISH case above, and it must answer, naming the dish, rather than offer",
    },
    {
        message: "what if I stirred in some gruyère and parmesan?",
        expect: null,
        dish: "mornay",
        why: "'what if' is a question however concrete it gets",
    },
    {
        message: "what can I use instead of nutmeg?",
        expect: null,
        why: "a substitution QUESTION, answered in prose",
    },
    {
        message: "why does my sauce go lumpy?",
        expect: null,
        why: "an ordinary technique question",
    },
    {
        message: "can you write this for 8 people?",
        expect: null,
        why: "servings — answered by pointing at the control",
    },
];

/** The first line the model produced, trimmed. */
async function firstLine(message: string): Promise<string> {
    const stream = createChatCompletion(
        [
            { role: "system", content: buildRecipeChatPrompt(BECHAMEL) },
            { role: "user", content: message },
        ],
        [],
        { stream: true, model: "gpt-4o", temperature: 0.7 }
    );

    let text = "";

    for await (const event of stream) {
        if (event.type === "chunk") text += event.delta;
        // Enough to classify — a prose answer can run for paragraphs and every
        // one of them costs money to receive.
        if (text.includes("\n") || text.length > 120) break;
    }

    return text.split("\n")[0].trim();
}

const sentinelOf = (line: string): Expectation => {
    const match = /^\s*(NEWDISH|MODIFY|DIFFICULTY):/i.exec(line);
    return match ? (match[1].toUpperCase() as Expectation) : null;
};

async function main() {
    const repeats = Number(process.env.REPEAT ?? 1);

    let failures = 0;
    let total = 0;

    for (const testCase of CASES) {
        for (let run = 0; run < repeats; run++) {
            total++;

            const line = await firstLine(testCase.message);
            const got = sentinelOf(line);

            const nameOk =
                !testCase.dish || line.toLowerCase().includes(testCase.dish);

            const ok = got === testCase.expect && nameOk;

            if (!ok) failures++;

            console.log(
                `${ok ? "✓" : "✗"} ${testCase.expect ?? "PROSE"}${
                    testCase.dish ? ` (${testCase.dish})` : ""
                }  "${testCase.message}"\n    -> ${line.slice(0, 100)}${
                    ok ? "" : `\n    ${testCase.why}`
                }`
            );
        }
    }

    console.log(`\n${total - failures}/${total} correct`);

    // A non-zero exit so this can gate a prompt change, not just narrate one.
    if (failures > 0) process.exitCode = 1;
}

main();
