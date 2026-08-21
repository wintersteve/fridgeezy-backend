import { SuggestionSlotsDto } from "@fridgeezy/schemas";
import { canonicalizeName } from "@fridgeezy/toolkit";

import type { SuggestionAdmission } from "./persist-or-reuse-suggestion";

/**
 * How many cards this batch has committed to, and who is already on screen.
 *
 * ## Why the count is kept here rather than derived from the frames
 *
 * This endpoint used to announce one anonymous placeholder per dish the moment
 * the model wrote its name, and take it back with a `withdrawn` frame if the
 * notability gate or dedup then dropped it. That made the screen a live view of
 * the pipeline: four placeholders appeared as lines were parsed, two vanished
 * as `obscure` verdicts landed, two more appeared when the top-up pass refilled
 * the slots, and the user watched all of it.
 *
 * A slot is now counted only when a dish is ADMITTED — past the gate, past
 * every dedup layer, past the "is this already on screen" checks below — so it
 * is a promise the batch can keep. The count is announced once and re-announced
 * when it changes, and the client draws `slots - cards` skeletons.
 *
 * The ledger owns the name/id bookkeeping too, because admission is exactly the
 * moment a dish stops being a candidate and starts occupying the feed: reserving
 * its name here is what stops a later sibling — or the top-up pass — proposing
 * the same dish a second time.
 *
 * Its own module, importing only types and `canonicalizeName`, so
 * `slot-frames.check.ts` can drive it with no database and no LLM. Everything
 * else in this directory constructs a Supabase client at module scope.
 */
export interface SlotLedger {
    /**
     * Count a dish that has cleared everything, unless it is already on screen.
     *
     * Suppression lands HERE rather than at card time on purpose: a slot that
     * would have to be taken back is a slot that should never have been drawn.
     */
    admit(tempId: string, admission: SuggestionAdmission): void;
    /** Was this dish counted? False means it was suppressed as a duplicate. */
    isAdmitted(tempId: string): boolean;
    /** Give back a slot whose dish died after admission. Returns true if it held one. */
    retract(tempId: string): void;
    /** Record the persisted row's id, now that the card is going out. */
    deliver(tempId: string, id: string): void;
    /**
     * Declare that the batch is still trying to reach `total` cards, so the
     * count reported to the client stops at that floor instead of dropping to
     * what has been admitted so far. `null` gives up the aim.
     *
     * This is what covers a TOP-UP PASS. A first pass that admits one of four
     * leaves the batch three short, and the backend immediately asks the model
     * for three more — but without an aim the client is told "one card", drops
     * its skeletons, and then sits on a one-card list for the several seconds
     * that takes. Reporting the aim keeps a skeleton under each slot the batch
     * is actively working on.
     *
     * It is the one number here that is a hope rather than a promise, which is
     * why it is separate from {@link count} and why only the FRAME sees it: the
     * top-up loop still sizes its request from what has actually been admitted.
     * An aim the top-up cannot fill is dropped when the stream ends, and the
     * client clears the leftover skeletons then.
     */
    aimFor(total: number | null): void;
    /** Names to exclude from the next pass — admitted, whether or not sent yet. */
    readonly names: string[];
    /** Cards actually admitted. Never the aim — see {@link aimFor}. */
    readonly count: number;
    /**
     * The frame to send, or null when nothing a client can see has changed.
     *
     * `verify` latches: once the first pass has been judged in full the count is
     * trustworthy, and a top-up raising it later does not make it untrustworthy
     * again. See `SuggestionSlotsSchema`.
     */
    frame(verify?: boolean): SuggestionSlotsDto | null;
}

export function createSlotLedger(alreadyOnScreen: string[]): SlotLedger {
    /** tempIds holding a slot. */
    const admitted = new Set<string>();
    /** Suggestion row ids this response has already committed to. */
    const ids = new Set<string>();
    /**
     * Canonical keys of dishes that must not produce a second card, seeded with
     * what the client says it is already showing. Keyed the way the database
     * keys `canonical_id`, so "Tarte Tatin" and "tarte  tatin!" are one entry.
     */
    const keys = new Set(
        alreadyOnScreen.map(canonicalizeName).filter(Boolean) as string[]
    );
    const names: string[] = [];

    let verified = false;
    let aim: number | null = null;
    let sentSlots: number | null = null;
    let sentVerified = false;

    return {
        admit(tempId, { name, id }) {
            const key = canonicalizeName(name);

            // Dedup resolving to an existing row is a SUCCESS — the single
            // suggestion endpoint returns it as-is. The batch feed must not:
            // drawing it renders one dish twice, under two tempIds and one id.
            if ((id && ids.has(id)) || (key && keys.has(key))) {
                console.log(
                    `[Suggestions] Not drawing "${name}" — already shown in this feed`
                );
                return;
            }

            if (id) ids.add(id);
            if (key) keys.add(key);
            names.push(name);
            admitted.add(tempId);
        },
        isAdmitted: (tempId) => admitted.has(tempId),
        retract(tempId) {
            // The name stays reserved. A sibling is welcome to the dish only if
            // it can actually store it, and the reason we are here is that
            // storing it just failed.
            admitted.delete(tempId);
        },
        deliver(tempId, id) {
            if (admitted.has(tempId)) ids.add(id);
        },
        aimFor(total) {
            aim = total;
        },
        names,
        get count() {
            return admitted.size;
        },
        frame(verify = false) {
            if (verify) verified = true;

            const slots = Math.max(admitted.size, aim ?? 0);

            if (slots === sentSlots && verified === sentVerified) return null;

            sentSlots = slots;
            sentVerified = verified;

            return { slots, verified };
        },
    };
}
