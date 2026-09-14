import { generateCompletion } from "@fridgeezy/llm";

/**
 * Ask, without acting on the answer, whether the card this turn produced
 * actually satisfies what the reader asked for.
 *
 * ## Shadow only. It changes nothing.
 *
 * It runs after the card is decided, logs a verdict and returns. No frame reads
 * it, no branch depends on it, and a failure is swallowed. That is the whole
 * design: the case for a live constraint gate is the weakest of the three made
 * on 2026-09-14, and it is the only one that can make a turn WORSE — a false
 * rejection throws away a correct catalogue hit and pays for a generation
 * instead, which is the cost the catalogue-first ladder exists to avoid.
 *
 * So it earns enforcement with evidence or not at all. What to look at:
 *
 *     filter type = "constraint_shadow" | stats count() by satisfied
 *     filter type = "constraint_shadow" and satisfied = false
 *
 * A rejection rate near zero says the gates added on 2026-09-13/14 (`cuisine`,
 * `course`, `blacklist`, `pairsWith`, the CONTAINS/GOES-WITH split) already
 * cover it and a model judging a model buys nothing. A rate of a few percent
 * whose reasons read true is the case for turning it on. A high rate almost
 * certainly means the judge is wrong, not the search — check the reasons before
 * believing the number.
 *
 * ## OPT-IN, and it should be deleted rather than left standing
 *
 * `CONSTRAINT_SHADOW=on`. Off by default, so it costs nothing and cannot fail
 * anything until somebody chooses to collect. That inverts this repo's usual
 * rule that a flag must fail safe by omission — here the flag's absence IS the
 * safe state, because the feature does nothing but spend money.
 *
 * It is scoped to a decision, like `COMPOSE_RETRIEVAL=off` was: once there is a
 * week of data the answer is either "build the gate" or "do not", and this file
 * goes either way. It is not a standing fixture.
 *
 * ## Why a separate call rather than reading the summary
 *
 * The summary model is already making this judgement — it is what said "while
 * not traditionally considered an Asian dish" on the turn that prompted all
 * this. But its prompt asks it to SELL the card ("say why it answers what they
 * asked"), and asking one call to advocate and adjudicate is the arrangement
 * `runAdaptationGate` deliberately avoids when it calls the raw classifier
 * instead of the fail-open wrapper. A verdict wants its own call and its own
 * schema.
 */
const ENABLED = process.env.CONSTRAINT_SHADOW === "on";

const SYSTEM_PROMPT = `You check whether a recipe suggestion actually satisfies what the user asked for.

You are given the user's message and the dish that was offered. Decide ONLY whether the dish meets the constraints the user actually STATED. Do not judge whether it is a good suggestion, whether it is well known, or whether you would have chosen it.

Constraints are things like: an origin ("an Asian dish"), an ingredient it must contain ("with béchamel"), a course ("a side"), a dish it must accompany ("goes with the chicken"), something it must not be ("not lasagne"), a diet, a difficulty.

Rules:
- A constraint the user did not state cannot be violated. "Give me a pasta dish" states one thing.
- Judge the DISH, not its name. A dish is Asian if the dish is Asian.
- If the user asked for something to go WITH a dish, the dish they named is NOT a valid answer.
- When you are unsure, answer satisfied: true. This check exists to catch clear failures, not close calls.

Output EXACTLY this JSON and nothing else:
{"satisfied": true|false, "unmet": ["<the stated constraint this dish fails>", "..."]}`;

export interface ShadowCandidate {
    name: string;
    description: string;
    tags: string[];
    ingredients: string[];
}

/**
 * Log a verdict for this turn. Never throws, never awaited by anything the
 * reader is waiting on, and returns nothing a caller could branch on — the
 * return type is `void` on purpose, so this cannot quietly become a gate
 * without someone changing the signature.
 */
export async function shadowCheckConstraints(
    userMessage: string,
    candidate: ShadowCandidate
): Promise<void> {
    if (!ENABLED || !userMessage.trim()) return;

    try {
        const { text } = await generateCompletion({
            model: { openai: "gpt-4.1-mini" },
            label: "chat.constraint_shadow",
            system: SYSTEM_PROMPT,
            user: [
                `User asked: ${userMessage}`,
                "",
                `Dish offered: ${candidate.name}`,
                `Description: ${candidate.description}`,
                `Tags: ${candidate.tags.join(", ") || "(none)"}`,
                `Ingredients: ${candidate.ingredients.join(", ") || "(none)"}`,
            ].join("\n"),
        });

        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");

        if (start === -1 || end <= start) return;

        const parsed = JSON.parse(text.slice(start, end + 1)) as {
            satisfied?: unknown;
            unmet?: unknown;
        };

        // One JSON line per turn, the same shape `TurnTimer` writes, so it is
        // queryable with the tooling that already exists.
        console.log(
            JSON.stringify({
                type: "constraint_shadow",
                satisfied: parsed.satisfied !== false,
                unmet: Array.isArray(parsed.unmet)
                    ? parsed.unmet.filter(
                          (item): item is string => typeof item === "string"
                      )
                    : [],
                asked: userMessage.slice(0, 200),
                offered: candidate.name,
            })
        );
    } catch (error) {
        // Swallowed by design. A shadow check that fell over must not appear
        // anywhere a reader or an on-call engineer would have to react to it.
        console.warn("[ConstraintShadow] check failed:", error);
    }
}
