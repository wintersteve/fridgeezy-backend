import type { IncomingMessage } from "node:http";

import {
    listTasteSignals,
    persistTasteSignal,
    TasteSignalKind,
} from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";
import type { Request } from "express";

import { trackBackgroundTask } from "../../../background-tasks";

import { resolveProfileId } from "./resolve-profile-id";

/**
 * How many times a cook has to ask for something before the app treats it as a
 * preference rather than as a one-off.
 *
 * **Set by hand, and no `calibrate*` target has any say** — the same exception
 * `TIME_BAND_MAX_MINUTES` occupies. The thresholds that must not be nudged
 * (`SIGNATURE_HIGH/LOW_THRESHOLD`, the authenticity floor) are fitted to a
 * measured distribution, and moving one unfits it. This is a product statement:
 * "make this one vegetarian" is a fact about a dinner party, and asking twice is
 * where we decide it is a fact about the cook. There is no distribution to fit
 * it to. Do not add one.
 *
 * Two is deliberately forgiving in the direction that costs least. Too low and
 * a guest's dietary requirement follows the host around for months; too high
 * and the feature simply does nothing for a while, which is the failure a user
 * never notices.
 */
const TASTE_SIGNAL_MIN_OCCURRENCES = 2;

/**
 * How many signals may reach the prompt. Caps how far the user prompt can grow
 * for a cook who has been using the app for a year — this is the one part of
 * the prompt that grows without bound otherwise.
 */
const TASTE_SIGNAL_LIMIT = 6;

/**
 * The value stored for a signal, and the key it is counted under.
 *
 * `canonicalizeName` is the right tool here specifically because **both sides
 * are normalised by it** — this function writes the column and reads it back,
 * and nothing else touches it. That is the one use its own docstring sanctions;
 * it deliberately does not mirror any `canonical_id` in the database, so it must
 * never be compared against a stored canonical column.
 *
 * Without it every phrasing gets its own row — "make it spicier", "Make this
 * spicier" and "spicier" would be three signals with a count of one each, and
 * nothing would ever reach the threshold.
 */
const signalValue = (raw: string): string | null => canonicalizeName(raw);

/** `dairy_free` -> `dairy free`, for reading back into a prompt. */
const readable = (value: string): string => value.replace(/_/g, " ");

/**
 * Record one revealed preference.
 *
 * **Returns void and never throws, by design.** Every caller is a stream
 * handler in the middle of a paid model call; there is no outcome here worth
 * failing a recipe over, and no branch a caller could usefully take. The
 * repository throws honestly and this is the layer that decides to swallow it.
 *
 * Runs as a tracked background task rather than being awaited, so the profile
 * lookup and the write never sit between the user and their first streamed
 * token. Tracked rather than merely floated because on Lambda an unawaited
 * promise is frozen when the handler returns — `lambda.ts` drains the registry
 * after the response closes.
 */
export function recordTasteSignal(
    req: IncomingMessage | undefined,
    kind: TasteSignalKind,
    rawValue: string
): void {
    const value = signalValue(rawValue);

    if (!value) {
        return;
    }

    void trackBackgroundTask(
        (async () => {
            const profileId = await resolveProfileId(
                req ? (req as Request).supabaseUserId : undefined
            );

            // No profile is the normal case under `ALLOW_UNAUTHENTICATED`, and
            // an eval or a background job has no request at all. Nothing to
            // attribute the signal to, so there is nothing to record.
            if (!profileId) {
                return;
            }

            await persistTasteSignal(profileId, kind, value);
        })()
    ).catch((error: unknown) => {
        console.error(
            "[Taste] Failed to record signal:",
            error instanceof Error ? error.message : String(error)
        );
    });
}

/**
 * How each kind of signal is worded as an instruction to the modify prompt.
 *
 * `difficulty` and `substitution` need real sentences rather than the bare
 * label: "easier" alone is ambiguous to a model rewriting a recipe, and a
 * substitution label is an ingredient NAME, which on its own reads as a request
 * to add it.
 *
 * Note how weakly `substitution` is worded. Someone asking twice what to use
 * instead of coriander has told you they often do not have it in — not that
 * they will not eat it. That is what `profile_blacklisted_ingredients` is for,
 * and it is enforced elsewhere, absolutely. This one may be declined by the
 * dish.
 */
const KIND_INSTRUCTION: Record<TasteSignalKind, (label: string) => string> = {
    modification: (label) => `make it ${label}`,
    difficulty: (label) =>
        label === "easier"
            ? "keep the technique plain and the step count low"
            : "take the technique further, with more refined method",
    substitution: (label) =>
        `they often do not have ${label} in — swap it for an authentic alternative if the dish allows`,
};

/**
 * One preference, named the way the cook wrote it.
 *
 * Local rather than in `@fridgeezy/schemas`: nothing crosses the wire in this
 * shape. The client reads its own rows straight out of `profile_taste_signals`
 * under RLS, the way it already reads `profile_settings`,
 * `profile_dietary_preferences` and `profile_blacklisted_ingredients` — so the
 * shared contract it needs is the generated table type, which it already has.
 */
export interface AppliedTasteSignal {
    kind: TasteSignalKind;
    label: string;
}

/**
 * A cook's standing preferences, resolved into something the modify prompt can
 * act on.
 *
 * One call returns both halves, and they must not be produced separately: the
 * set named to the user has to be the same set the model was given, or the app
 * ends up claiming a change it never asked for.
 */
export interface StandingPreferences {
    /** The instruction handed to the shared modify prompt. */
    instruction: string;
    /** The same signals, for the client to name in the offer. */
    applied: AppliedTasteSignal[];
}

/**
 * What this cook keeps asking for, or `null` when they have not asked for
 * anything twice yet.
 *
 * ## This is NOT applied at generation time, and that is the whole design
 *
 * An earlier version of this folded the preferences into the promote and
 * generate prompts. That was wrong, and quietly so: those two persist with
 * `created_by NULL`, i.e. into the **shared catalogue**, where
 * `findByCanonicalName` hands the row to the next person who promotes the same
 * dish. One cook's palate would have been written into the dish everyone else
 * reads — and with a single catalogue slot per (canonical_id, difficulty),
 * whoever promoted first would have defined it for all of them. It is also
 * exactly what the authenticity gate exists to prevent, arriving through a door
 * that gate does not watch.
 *
 * So the catalogue recipe stays canonical, and preferences apply as a VARIANT
 * off it — the same shape `decideReuse` already uses for a blacklist, including
 * its economics: paid once per cook per dish family, then served free from
 * `recipe_family_defaults`.
 *
 * Reads through RLS-free service role, but only ever for the caller's own
 * profile, resolved from a verified token.
 */
export async function readStandingPreferences(
    req: IncomingMessage | undefined
): Promise<StandingPreferences | null> {
    try {
        const profileId = await resolveProfileId(
            req ? (req as Request).supabaseUserId : undefined
        );

        if (!profileId) {
            return null;
        }

        const signals = await listTasteSignals(profileId, {
            minOccurrences: TASTE_SIGNAL_MIN_OCCURRENCES,
            limit: TASTE_SIGNAL_LIMIT,
        });

        if (signals.length === 0) {
            return null;
        }

        const applied: AppliedTasteSignal[] = signals.map((signal) => ({
            kind: signal.kind as TasteSignalKind,
            label: readable(signal.value),
        }));

        const instruction = applied
            .map((signal) => KIND_INSTRUCTION[signal.kind](signal.label))
            .join("; ");

        return { instruction, applied };
    } catch (error) {
        // Nothing here is worth failing a request over: the caller either
        // offers the adaptation or it does not.
        console.error(
            "[Taste] Failed to read standing preferences:",
            error instanceof Error ? error.message : String(error)
        );

        return null;
    }
}
