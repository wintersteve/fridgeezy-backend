import { z } from "zod/v4";

/**
 * How much of the clock a dish asks for, in three bands.
 *
 * ## Why a band and not a number
 *
 * The cards used to show an exact minute count that was invented: the client's
 * `getRecipeMeta` hashed a card's id into 10–60 minutes so the value at least
 * stayed stable between renders. It was never connected to the recipe, so a card
 * promising "35 min" opened onto a recipe with 20 prep + 55 cook and nothing
 * reconciled the two.
 *
 * A band is the honest shape for this because of WHEN each side is known. A
 * suggestion is a card that exists BEFORE its recipe does — there is no prep or
 * cook time yet, only an estimate — and an estimate rendered to the minute claims
 * a precision it does not have. Three bands is roughly the resolution an estimate
 * of an unwritten recipe actually carries, so a small miss no longer contradicts
 * anything on screen.
 *
 * ## The axis is the CLOCK, not the effort
 *
 * `long` means "this occupies your afternoon", not "this is hard work" — a
 * three-hour braise is twenty minutes of work and still lands here. That is
 * deliberate, and it is why the top band must not be worded as difficulty: the
 * pill beside this one already carries `difficulty`, and if both said "hard" one
 * of them would be lying about a dish you mostly wait for.
 *
 * Measuring hands-on time instead was considered and rejected: it is not
 * derivable from anything stored (step durations count waiting too), so it would
 * need a second estimated number, doubling what has to be kept honest to fix a
 * problem caused by the first one being unanchored.
 */
export const TimeBandSchema = z.enum(["quick", "moderate", "long"]);

export type TimeBand = z.infer<typeof TimeBandSchema>;

/**
 * Upper bounds in minutes, inclusive. `long` is everything above `moderate`.
 *
 * Round numbers rather than fitted ones, and unlike the dedup thresholds these
 * are NOT calibrated against a measured distribution — there is nothing to fit
 * them to. They are a product statement about what a weeknight allows, so they
 * are safe to move by hand; the `calibrate*` targets have no say here.
 */
export const TIME_BAND_MAX_MINUTES = {
    quick: 30,
    moderate: 90,
} as const;

/**
 * The band a total time falls in — the ONE definition, used by both sides.
 *
 * A recipe derives its band from `prep_time + cook_time`, which is why the pill
 * cannot contradict the detail screen: it is computed from the same two numbers
 * that screen renders. A suggestion derives it from the single total the
 * generator estimated. Same function, so a dish cannot change bands merely by
 * being promoted.
 *
 * Returns `undefined` for a missing or nonsensical total rather than guessing a
 * band. Suggestions written before this column existed have no estimate, and
 * inventing one for them is precisely the bug this replaces — the client renders
 * no pill instead.
 */
export const timeBandFor = (
    totalMinutes: number | null | undefined
): TimeBand | undefined => {
    if (typeof totalMinutes !== "number" || !Number.isFinite(totalMinutes)) {
        return undefined;
    }
    if (totalMinutes <= 0) return undefined;

    if (totalMinutes <= TIME_BAND_MAX_MINUTES.quick) return "quick";
    if (totalMinutes <= TIME_BAND_MAX_MINUTES.moderate) return "moderate";

    return "long";
};
