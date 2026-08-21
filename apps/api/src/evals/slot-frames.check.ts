/**
 * Offline check for the suggestion feed's slot accounting.
 *
 * Runs entirely in memory — no database, no LLM, no API keys — because what it
 * verifies is a CONCURRENCY property, and one that holds "usually" is what put
 * the previous placeholder contract on screen: four skeletons appearing as the
 * model wrote its lines, two vanishing as `obscure` verdicts landed, two more
 * appearing when the top-up pass refilled the slots.
 *
 * Two claims under test:
 *
 * 1. **A slot is announced as soon as its dish is admitted, whatever order the
 *    gate calls return in.** Authenticity calls have been measured from 0.67s to
 *    5.53s in one batch, and the client leaves its searching interstitial on a
 *    timer. A count that waited on the slowest call would be wrong at the only
 *    moment anyone reads it.
 * 2. **Cards still go out in generation order**, because the client renders the
 *    batch as an ordered list.
 *
 * Those two pull in opposite directions, which is the whole reason
 * `generate-suggestions-stream` is built around a queue instead of one loop.
 *
 *     npx nx run @fridgeezy/api:check-slot-frames
 */
import {
    createFrameQueue,
    createGate,
} from "../modules/suggestions/services/frame-queue";
import { createSlotLedger } from "../modules/suggestions/services/slot-ledger";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The real pass loop, with the model and the pipeline replaced by timers.
 *
 * `lineDelays[i]` is how long the model takes to write dish `i`; `gateDelays[i]`
 * is how long that dish then spends being judged. Returns the frames in the
 * order a client would receive them.
 */
async function runPass(
    lineDelays: number[],
    gateDelays: number[],
    /** Dishes whose "persist" fails after admission. */
    failsAfterAdmit: number[] = []
): Promise<string[]> {
    const queue = createFrameQueue<string>();
    const ledger = createSlotLedger([]);
    const judged: Promise<number>[] = [];
    const arrivals = createGate();
    let linesDone = false;

    const push = (frame: { slots: number; verified: boolean } | null) => {
        if (frame) queue.push(`slots:${frame.slots}${frame.verified ? "!" : ""}`);
    };

    const readLines = async () => {
        try {
            for (let index = 0; index < lineDelays.length; index++) {
                await sleep(lineDelays[index]);

                const tempId = `t${index}`;

                judged.push(
                    sleep(gateDelays[index]).then(() => {
                        ledger.admit(tempId, { name: `Dish ${index}` });
                        push(ledger.frame());
                        return index;
                    })
                );

                arrivals.open();
            }
        } finally {
            linesDone = true;
            arrivals.open();
        }
    };

    const emitCards = async () => {
        for (let i = 0; ; i++) {
            // No `await` between the test and the wait, or a line arriving in
            // between is missed and the pass hangs.
            while (i >= judged.length) {
                if (linesDone) return;
                await arrivals.next();
            }

            const index = await judged[i];
            const tempId = `t${index}`;

            if (failsAfterAdmit.includes(index)) {
                ledger.retract(tempId);
                push(ledger.frame());
                continue;
            }

            ledger.deliver(tempId, `id${index}`);
            queue.push(`card:${index}`);
        }
    };

    const producer = Promise.all([readLines(), emitCards()])
        .then(() => push(ledger.frame(true)))
        .finally(() => queue.close());

    const frames: string[] = [];
    for await (const frame of queue.drain()) frames.push(frame);
    await producer;

    return frames;
}

const cards = (frames: string[]) => frames.filter((f) => f.startsWith("card:"));

async function main() {
    console.log("\nSlot announcement vs card ordering\n");
    {
        // The shape from a real log: one gate call runs long while its siblings
        // return in well under a second.
        const frames = await runPass([5, 5, 5, 5], [30, 200, 40, 50]);

        check(
            "cards keep generation order despite a slow second gate",
            cards(frames).join(",") === "card:0,card:1,card:2,card:3",
            cards(frames).join(",")
        );
        check(
            "a slow dish does not hold back its siblings' slots",
            frames.indexOf("slots:4") < frames.indexOf("card:1"),
            frames.join(" ")
        );
        check(
            "the final count is verified exactly once, last",
            frames.filter((f) => f.endsWith("!")).length === 1 &&
                frames[frames.length - 1] === "slots:4!",
            frames.join(" ")
        );
    }
    {
        // Every dish answered by `findKnownDish` — two indexed lookups, no LLM.
        const frames = await runPass([20, 20, 20, 20], [1, 1, 1, 1]);

        check(
            "the database fast path drains without stalling",
            cards(frames).length === 4 && frames[frames.length - 1] === "slots:4!",
            frames.join(" ")
        );
    }
    {
        // Every line lands before any verdict does. The reader finishing must
        // not truncate the queue.
        const frames = await runPass([0, 0, 0, 0], [80, 60, 40, 20]);

        check(
            "a reader that finishes first does not truncate the batch",
            cards(frames).join(",") === "card:0,card:1,card:2,card:3",
            frames.join(" ")
        );
    }
    {
        const frames = await runPass([], []);

        check(
            "a pass that generated nothing still reports a verified zero",
            frames.join(",") === "slots:0!",
            frames.join(",")
        );
    }

    console.log("\nThe count only shrinks for a dish that died after admission\n");
    {
        const frames = await runPass([5, 5, 5, 5], [10, 10, 10, 10], [2]);

        check(
            "a post-admission failure gives its slot back",
            frames[frames.length - 1] === "slots:3!",
            frames.join(" ")
        );
        check(
            "and takes no card with it",
            cards(frames).join(",") === "card:0,card:1,card:3",
            cards(frames).join(",")
        );
    }

    console.log("\nA dish already on screen is never counted\n");
    {
        const ledger = createSlotLedger(["Tarte  Tatin!"]);

        ledger.admit("a", { name: "tarte tatin" });
        check(
            "the client's own exclude list suppresses a canonical-equal name",
            ledger.count === 0 && !ledger.isAdmitted("a"),
            `count ${ledger.count}`
        );

        ledger.admit("b", { name: "Pajeon" });
        ledger.admit("c", { name: "Pajeon" });
        check(
            "two siblings resolving to one name take one slot",
            ledger.count === 1 && !ledger.isAdmitted("c"),
            `count ${ledger.count}`
        );

        ledger.admit("d", { name: "Bibimbap", id: "row-1" });
        ledger.admit("e", { name: "Bibimbap (alt)", id: "row-1" });
        check(
            "dedup resolving twice to one ROW takes one slot",
            ledger.count === 2 && !ledger.isAdmitted("e"),
            `count ${ledger.count}`
        );

        check(
            "only admitted names are offered to the top-up pass",
            ledger.names.join(",") === "Pajeon,Bibimbap",
            ledger.names.join(",")
        );
    }

    console.log("\n`verified` latches\n");
    {
        const ledger = createSlotLedger([]);

        ledger.admit("a", { name: "One" });
        check("an unverified count is sent as it grows", ledger.frame()?.verified === false);
        check("an unchanged count sends nothing", ledger.frame() === null);
        check("verifying sends, even at the same count", ledger.frame(true)?.verified === true);

        // A top-up pass raising the count must not un-verify it, or a batch that
        // admitted nothing on its first pass drops back into the interstitial.
        ledger.admit("b", { name: "Two" });
        const next = ledger.frame();
        check(
            "a later admission stays verified",
            next?.slots === 2 && next.verified === true,
            JSON.stringify(next)
        );
    }

    console.log("\nA top-up pass keeps its skeletons\n");
    {
        const ledger = createSlotLedger([]);

        ledger.admit("a", { name: "One" });
        ledger.aimFor(4);
        check(
            "a batch still topping up reports the target, not its tally",
            ledger.frame(true)?.slots === 4,
            JSON.stringify(ledger.frame(true))
        );
        check(
            "but the top-up itself is still sized from what was admitted",
            ledger.count === 1,
            `count ${ledger.count}`
        );

        ledger.admit("b", { name: "Two" });
        check(
            "a card landing inside the aim needs no frame at all",
            ledger.frame() === null
        );

        ledger.aimFor(null);
        check(
            "giving up the aim reports what was really delivered, once",
            ledger.frame(true)?.slots === 2,
            `count ${ledger.count}`
        );
    }

    console.log(
        failures === 0
            ? "\nAll slot frame checks passed.\n"
            : `\n${failures} check(s) FAILED.\n`
    );

    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
