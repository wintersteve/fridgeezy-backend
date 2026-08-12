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
import type {
    CuisineRelation,
    CuisineRelator,
} from "../modules/suggestions/services/cuisine-identity";
import {
    createSuggestionBatch,
    type SameDishAdjudicator,
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
    embedding: number[],
    /**
     * Defaults to null — "unknown", which merges. Every test predating cuisine
     * identity therefore keeps testing exactly what it tested before.
     */
    cuisine: string | null = null
): SuggestionIdentity {
    return { key, cuisine, name, describe: `name: ${name}`, embedding };
}

/**
 * A fixture slice of the real cuisine tree, so the relator stays a pure function
 * and this check keeps needing no database.
 */
const PARENT: Record<string, string | null> = {
    asian: null,
    african: null,
    european: null,
    middle_eastern: "asian",
    central_asian: "asian",
    east_asian: "asian",
    mediterranean: "european",
    north_african: "african",
    levantine: "middle_eastern",
    turkish: "mediterranean",
    kazakh: "central_asian",
    chinese: "east_asian",
    sichuan: "east_asian",
};

const isAncestor = (ancestor: string, descendant: string): boolean => {
    let current = PARENT[descendant] ?? null;
    for (let i = 0; current && i < 10; i++) {
        if (current === ancestor) return true;
        current = PARENT[current] ?? null;
    }
    return false;
};

/** The same four-way rule as `relateCuisines`, over the fixture tree above. */
const relate: CuisineRelator = (a, b): CuisineRelation => {
    if (!a || !b) return "unknown";
    if (a === b) return "same";
    if (!(a in PARENT) || !(b in PARENT)) return "disjoint";
    return isAncestor(a, b) || isAncestor(b, a) ? "ancestor" : "disjoint";
};

/** Every batch in this file gets the deterministic relator. */
const makeBatch = (adjudicate: SameDishAdjudicator) =>
    createSuggestionBatch(adjudicate, relate);

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
        const batch = makeBatch(never);
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
        const batch = makeBatch(never);
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
        const batch = makeBatch(never);
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
        const batch = makeBatch(async () => {
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
        const batch = makeBatch(never);
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
        const batch = makeBatch(never);
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
        const batch = makeBatch(never);
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

    // 8. HOMOGRAPHS. One canonical name, two dishes, told apart only by cuisine.
    //    Before 20260812000003 the shared key collapsed these unconditionally,
    //    which is how Kazakh Manti was silently replaced by the Turkish dish.
    {
        const batch = makeBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(
                    batch,
                    identity("Manti", "manti", unit(0), "turkish"),
                    { settleAfterMs: 20 }
                ),
                runDish(
                    batch,
                    identity("Manti", "manti", unit(DISTINCT), "kazakh"),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "homograph"
        );

        check(
            "same name in a disjoint cuisine stays distinct",
            second.duplicateOf === null
        );
    }

    // 9. A null cuisine is a WILDCARD that merges, not a distinct identity.
    //    This is what keeps every row the backfill could not fill — and every
    //    dish whose tags name no cuisine — behaving as it always has.
    {
        const batch = makeBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(batch, identity("Pierogi", "pierogi", unit(0), "polish"), {
                    settleAfterMs: 20,
                }),
                runDish(
                    batch,
                    identity("Pierogi", "pierogi", unit(DISTINCT), null),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "unknown cuisine"
        );

        check(
            "an unknown cuisine merges rather than splitting",
            second.duplicateOf !== null
        );
    }

    // 10. Ancestor drift — `levantine` under `middle eastern`. This is the drift
    //     that ACTUALLY occurs (Shawarma is split across both in the live
    //     catalogue), and the tree resolves it for free, with no LLM.
    {
        const batch = makeBatch(never);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(
                    batch,
                    identity("Shawarma", "shawarma", unit(0), "middle_eastern"),
                    { settleAfterMs: 20 }
                ),
                runDish(
                    batch,
                    identity("Shawarma", "shawarma", unit(DISTINCT), "levantine"),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "ancestor drift"
        );

        check(
            "an ancestor-related cuisine merges with no adjudication",
            second.duplicateOf !== null
        );
    }

    // 11. The failure DIRECTION on a same-name pair, which the composite unique
    //     constraint inverted. Fail closed and the two siblings both persist —
    //     and the constraint now permits that, so the duplicate is permanent and
    //     nothing collapses it. Fail open and one dish merges into the other,
    //     which is exactly what shipped before the column existed.
    //
    //     Pins that `suggestion-batch` PASSES `onError: true` here. Deleting that
    //     option as redundant is the regression this exists to catch.
    {
        let sawOnError: boolean | undefined;
        const failing: SameDishAdjudicator = async (_a, _b, options) => {
            sawOnError = options?.onError;
            // What the real adjudicator returns from its own catch block.
            return options?.onError ?? false;
        };

        const batch = makeBatch(failing);
        const [, second] = await withTimeout(
            Promise.all([
                runDish(
                    batch,
                    identity("Moussaka", "moussaka", unit(0), "turkish"),
                    { settleAfterMs: 20 }
                ),
                runDish(
                    batch,
                    identity("Moussaka", "moussaka", unit(GRAY_BAND), "kazakh"),
                    { identifyAfterMs: 5 }
                ),
            ]),
            2000,
            "adjudicator failure on a same-name pair"
        );

        check(
            "a same-name pair asks the adjudicator to fail OPEN",
            sawOnError === true,
            `onError was ${sawOnError}`
        );
        check(
            "an adjudicator failure on a same-name pair merges",
            second.duplicateOf !== null
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
