/**
 * The rule that turns `ingredients.shelf_life` — a sentence — into the two
 * columns the fridge reads.
 *
 * Its own module so `check-shelf-life.ts` can import it without running the
 * backfill: `backfill-shelf-life.ts` calls `main()` at import time, as every
 * operation here does, so a check that imported it would talk to a database in
 * order to test a regex.
 *
 * The rule itself, and why it is this rule rather than another, is on
 * `backfill-shelf-life.ts`.
 */

/**
 * Days per unit, as the SENTENCE means them rather than as a calendar does.
 *
 * A month is 30 and a year is 365, which is why "12 months" lands on 360 and
 * "1 year" on 365 for what a person would call the same duration. Left alone
 * deliberately: the two phrasings are the source's, the five days are inside
 * any honest error bar on "how long does flour keep", and reconciling them
 * would mean inventing a rule the text does not contain.
 */
const UNIT_DAYS: Record<string, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
};

/**
 * The first `N unit` or `N-M unit` in the sentence, at N.
 *
 * The optional `[-–—] \d+` is consumed rather than captured, which is what
 * makes "1-2 days" read as one day and "6 months-2 years" read as six months.
 */
const DURATION = /(\d+)\s*(?:[-–—]\s*\d+\s*)?(day|week|month|year)s?/i;

export interface ShelfLife {
    expires: boolean;
    days: number | null;
}

/** The columns a sentence implies, or null when it implies nothing. */
export const parseShelfLife = (text: string): ShelfLife | null => {
    const value = text.trim();

    if (/^indefinite/i.test(value)) return { expires: false, days: null };

    const match = DURATION.exec(value);
    if (!match) return null;

    const days = Number(match[1]) * UNIT_DAYS[match[2].toLowerCase()];

    return days > 0 ? { expires: true, days } : null;
};
