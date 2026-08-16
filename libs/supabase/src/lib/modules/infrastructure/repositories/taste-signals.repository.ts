import { ProfileTasteSignal } from "@fridgeezy/types";

import { supabaseAdmin } from "../../client";

/**
 * The closed vocabulary of things worth remembering about a cook.
 *
 * Mirrors the check constraint on `profile_taste_signals.kind` — the two must
 * agree, and the constraint is the one that actually holds, so a value added
 * here without a migration fails at the insert rather than at compile time.
 *
 * - `modification` — what they ask `POST /recipes/modify` for ("spicier").
 * - `difficulty`   — which way they push `POST /recipes/difficulty/escalate`,
 *                    so `easier` or `harder`, never a level.
 * - `substitution` — an ingredient they asked to replace via
 *                    `POST /substitutes/generate`.
 */
export type TasteSignalKind = "modification" | "difficulty" | "substitution";

/**
 * Taste-signal reads and writes.
 *
 * Deliberately not built on a `@fridgeezy/domain` interface, for the same reason
 * `entitlements.repository.ts` next door is not: those six repositories model
 * the food domain and are consumed by a pipeline that benefits from the seam.
 * This is one table whose readers and writers are all in the API. Promote it if
 * a second consumer appears.
 */

/**
 * Record one revealed preference, incrementing its count if it has been seen
 * before.
 *
 * Goes through the `record_taste_signal` RPC rather than `.upsert()` because
 * the update half has to read the row it is updating (`occurrences + 1`), which
 * PostgREST's upsert cannot express.
 *
 * **Throws on failure, and the caller is expected to swallow it.** The honest
 * error belongs here — a future caller may care — but every caller today is a
 * stream handler in the middle of a paid model call, for which the only correct
 * response to "the signal did not save" is to carry on and serve the recipe.
 * See `recordTasteSignal` in the API's `taste-profile.ts`, which is where that
 * decision is taken and logged.
 *
 * Named `persist*` rather than `record*` to keep it distinct from that API-level
 * wrapper: the two differ in exactly the way that matters at a call site — this
 * one throws and awaits, the other never throws and never blocks.
 */
export async function persistTasteSignal(
    profileId: string,
    kind: TasteSignalKind,
    value: string
): Promise<void> {
    const { error } = await supabaseAdmin.rpc("record_taste_signal", {
        p_profile_id: profileId,
        p_kind: kind,
        p_value: value,
    });

    if (error) {
        throw new Error(`Failed to record taste signal: ${error.message}`);
    }
}

export interface ListTasteSignalsOptions {
    /**
     * Signals seen fewer times than this are read as one-offs and left out. A
     * single "make it vegetarian" is a fact about one dinner, not about the
     * cook.
     */
    minOccurrences: number;
    /** Caps how much of the user prompt this can grow to. */
    limit: number;
}

/**
 * The signals strong enough to act on, strongest first.
 *
 * Ordered by count and then by recency, so a preference someone has drifted
 * away from loses to one they still hold at the same count — the table never
 * forgets on its own, and this ordering is the only thing that ages a signal
 * out of the prompt.
 *
 * Throws on failure; the caller degrades to an unpersonalised recipe.
 */
export async function listTasteSignals(
    profileId: string,
    { minOccurrences, limit }: ListTasteSignalsOptions
): Promise<ProfileTasteSignal[]> {
    const { data, error } = await supabaseAdmin
        .from("profile_taste_signals")
        .select("*")
        .eq("profile_id", profileId)
        .gte("occurrences", minOccurrences)
        .order("occurrences", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to read taste signals: ${error.message}`);
    }

    return data ?? [];
}
