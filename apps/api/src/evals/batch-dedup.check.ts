/**
 * Offline check for the intra-batch dedup coordinator.
 *
 * Runs entirely in memory — no database, no LLM, no API keys — because what it
 * verifies is a CONCURRENCY property, and a property that only holds "usually"
 * is exactly what produced `Haemul Pajeon` alongside `Pajeon`, inserted 1.8s
 * apart by two halves of one batch that could not see each other.
 *
 * The claim under test: four suggestions started concurrently settle to the same
 * answers as four started one at a time, and never wait on each other in a cycle.
 *
 *     npx nx run @fridgeezy/api:check-batch-dedup
 */
import {
    createSuggestionBatch,
    type SuggestionIdentity,
} from "../modules/suggestions/services/suggestion-batch";
import type { SuggestionOutcome } from "../modules/suggestions/services/suggestion-outcome";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
}

/**
 * A deterministic stand-in for an embedding.
 *
 * Two dimensions are enough to hit any cosine we want: `unit(0)` and `unit(90)`
 * are orthogonal (0.0), and the angle between two vectors IS the similarity, so
 * a test can name the score it wants directly in degrees.
 */
function unit(degrees: number): number[] {
    const radians = (degrees * Math.PI) / 180;
    return [Math.cos(radians), Math.sin(radians)];
}

/** Degrees whose cosine lands in each band. HIGH 0.92, LOW 0.75. */
const AUTO_MERGE = 20; // cos 20° ≈ 0.940
const GRAY_BAND = 30; // cos 30° ≈ 0.866
const DISTINCT = 60; // cos 60° = 0.500

function identity(
    name: string,
    key: string | null,
    embedding: number[]
): SuggestionIdentity {
    return { key, name, describe: `name: ${name}`, embedding };
}

function persisted(id: string, name: string): SuggestionOutcome {
    return {
        kind: "suggestion",
        suggestion: {
            id,
            name,
            description: "",
            difficulty: "easy",
            ingredients: [],
            tags: [],
        },
    };
}

const never = async () => {
    throw new Error("adjudicator called when it should not have been");
};

/**
 * Drive one dish through a slot the way `persistOrReuseSuggestion` does, with a
 * caller-supplied delay before the identity is published — so a test can force
 * the "later sibling arrives while the earlier one is still working" interleaving
 * that the real stream produces and a sequential test never would.
 */
async function runDish(
    batch: ReturnType<typeof createSuggestionBatch>,
    dish: SuggestionIdentity,
    options: {
        identifyAfterMs?: number;
        settleAfterMs?: number;
        outcome?: SuggestionOutcome;
    } = {}
): Promise<{ duplicateOf: SuggestionOutcome | null; outcome: SuggestionOutcome }> {
    const slot = batch.open();
    const outcome = options.outcome ?? persisted(`id:${dish.name}`, dish.name);

    await sleep(options.identifyAfterMs ?? 0);
    slot.identify(dish);

    const duplicateOf = await slot.findEarlierDuplicate(dish);

    if (duplicateOf) {
        slot.settle(duplicateOf);
        return { duplicateOf, outcome: duplicateOf };
    }

    await sleep(options.settleAfterMs ?? 0);
    slot.settle(outcome);

    return { duplicateOf: null, outcome };
}

const sleep = (ms: number) =>
    ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** Fail the whole check rather than hang CI if the ordering rule ever breaks. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`deadlock: ${label}`)), ms)
        ),
    ]);
}

async function main() {
    console.log("\nIntra-batch dedup\n");

    // 1. The exact case from the report: the same dish named twice in one batch.
    //    Must cost nothing — no vector comparison, no LLM.
    {
        const batch = createSuggestionBatch(never);
        const [first, second] = await withTimeout(
            Promise.all([
                runDish(
                    batch,
                    identity("Cucumber Sunomono", "sunomono", unit(0)),
                    { settleAfterMs: 30 }
                ),
                runDish(batch, identity("Sunomono", "sunomono", unit(DISTINCT)), {
                    identifyAfterMs: 5,
                }),
            ]),
            2000,
            "same canonical name"
        );

        check("same canonical name collapses", second.duplicateOf !== null);
        check(
            "the collapsed dish adopts the original's row",
            second.outcome.kind === "suggestion" &&
                second.outcome.suggestion.id === "id:Cucumber Sunomono"
        );
        check("the first dish is not itself collapsed", first.duplicateOf === null);
    }

    // 2. Different names, near-identical signatures — the Shakshuka / Shakshuka
    //    with Merguez shape. Auto-merges above HIGH with no LLM call.
    {
        const batch = createSuggestionBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(batch, identity("Shakshuka", "shakshuka", unit(0)), {
                    settleAfterMs: 20,
                }),
                runDish(
                    batch,
                    identity(
                        "Shakshuka with Merguez",
                        "shakshuka_with_merguez",
                        unit(AUTO_MERGE)
                    ),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "auto-merge"
        );

        check("high-similarity siblings auto-merge without an LLM call", second.duplicateOf !== null);
    }

    // 3. Genuinely different dishes stay apart, and never reach the adjudicator.
    {
        const batch = createSuggestionBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(batch, identity("Carbonara", "carbonara", unit(0))),
                runDish(
                    batch,
                    identity("Cacio e Pepe", "cacio_e_pepe", unit(DISTINCT)),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "distinct"
        );

        check("distinct dishes stay distinct", second.duplicateOf === null);
    }

    // 4. The gray band is the adjudicator's, and only the gray band.
    {
        let calls = 0;
        const batch = createSuggestionBatch(async () => {
            calls++;
            return true;
        });

        const [, second] = await withTimeout(
            Promise.all([
                runDish(batch, identity("Pajeon", "pajeon", unit(0))),
                runDish(
                    batch,
                    identity("Haemul Pajeon", "haemul_pajeon", unit(GRAY_BAND)),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "gray band"
        );

        check("gray band reaches the adjudicator exactly once", calls === 1, `${calls} calls`);
        check("an adjudicated match collapses", second.duplicateOf !== null);
    }

    // 5. A sibling that failed to persist tells us nothing — do our own work
    //    rather than inheriting its failure.
    {
        const batch = createSuggestionBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(batch, identity("Ramen", "ramen", unit(0)), {
                    outcome: { kind: "dropped", reason: "persist_failed" },
                    settleAfterMs: 20,
                }),
                runDish(batch, identity("Ramen", "ramen", unit(0)), {
                    identifyAfterMs: 5,
                }),
            ]),
            2000,
            "failed sibling"
        );

        check(
            "a failed sibling is not adopted",
            second.duplicateOf === null && second.outcome.kind === "suggestion"
        );
    }

    // 6. An abandoned sibling (authenticity gate, unparseable line) must release
    //    anyone waiting on it instead of stalling the batch.
    {
        const batch = createSuggestionBatch(never);
        const abandoned = batch.open();
        const later = runDish(batch, identity("Pho", "pho", unit(0)), {
            identifyAfterMs: 10,
        });

        abandoned.abandon();

        const result = await withTimeout(later, 2000, "abandoned sibling");
        check("an abandoned sibling never blocks a later one", result.duplicateOf === null);
    }

    // 7. The ordering guarantee itself, at batch size. Four dishes that are ALL
    //    the same dish, settling in reverse order (the last to arrive finishes
    //    its own work first) — the interleaving most likely to expose a cycle.
    //    Exactly one must survive, and it must be the first to arrive.
    {
        const batch = createSuggestionBatch(never);
        const results = await withTimeout(
            Promise.all(
                [0, 1, 2, 3].map((index) =>
                    runDish(
                        batch,
                        identity(`Dish ${index}`, "one_dish", unit(0)),
                        {
                            identifyAfterMs: index * 2,
                            settleAfterMs: (4 - index) * 15,
                        }
                    )
                )
            ),
            5000,
            "four identical dishes"
        );

        const survivors = results.filter((r) => r.duplicateOf === null);

        check("exactly one of four identical dishes survives", survivors.length === 1, `${survivors.length} survived`);
        check(
            "the survivor is the first to arrive",
            results[0].duplicateOf === null
        );
        check(
            "every collapsed dish points at the survivor's row",
            results.every(
                (r) =>
                    r.outcome.kind === "suggestion" &&
                    r.outcome.suggestion.id === "id:Dish 0"
            )
        );
    }

    console.log(
        failures === 0
            ? "\nAll batch dedup checks passed.\n"
            : `\n${failures} check(s) FAILED.\n`
    );

    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
