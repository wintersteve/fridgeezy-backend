import type { ExampleRecipeStep } from "./recipe";

/**
 * The recipe's steps laid on a time axis — `buildRecipeTimeline` in the app,
 * ported.
 *
 * It answers questions the step list cannot: when to start if you want to eat
 * at eight, how much of the three hours is hands-off, and what can be done
 * while something else cooks. That is why the recipe page shows THIS rather
 * than the steps — the steps have a screen of their own, reached from Start
 * Cooking, exactly as cook mode is reached from the app's actions bar.
 *
 * ## What is NOT ported, and why that is safe here
 *
 * The app also reads durations out of a step's SENTENCE ("simmer for 20
 * minutes") for recipes saved before the generator supplied `duration_seconds`.
 * Every step in the fixture carries its own, so the estimator would never fire
 * — and with it goes the app's conditional caveat about times being read from
 * the wording. If a recipe without stored durations is ever rendered here, the
 * bars will all be zero rather than wrong, which is the right way round.
 */

/**
 * Steps that explicitly run against another one. The recipes say so in words —
 * "While the beef is braising, sauté the mushrooms" — and that sentence is the
 * only signal there is, since nothing in the data models dependency.
 *
 * **It is a heuristic and it misfires on this very recipe**, which is worth
 * knowing before trusting a bar: the final step reads "While still hot,
 * immediately sprinkle the fried nuggets…", where "while" qualifies the thing
 * just cooked rather than naming something else on the hob. The app draws
 * "While that cooks" on it too. Ported unchanged deliberately — a web page that
 * quietly computed a better answer than the product would make the example
 * unrepresentative, which is the same call the description's clamp got.
 */
const PARALLEL_PREFIX = /^\s*(while|meanwhile|as the|as it|during|in the meantime)\b/i;

/**
 * Whether the cook is actually needed. A step that marinates, rests or proves
 * is time the evening costs but the cook does not spend, and separating the two
 * is most of what the summary is for.
 */
const WAITING_VERBS =
    /\b(rest|marinate|chill|refrigerate|rise|prove|cool|soak|simmer|braise|bake|roast|freeze|set aside)\b/i;

export interface TimelineEntry {
    stepNumber: number;
    title: string | null;
    text: string;
    /** Seconds from the start of the cook. */
    startsAt: number;
    seconds: number;
    /** Time the evening costs but the cook does not spend. */
    waiting: boolean;
    /** Runs against the step before it rather than after it. */
    parallel: boolean;
}

export interface Timeline {
    entries: TimelineEntry[];
    totalSeconds: number;
    waitingSeconds: number;
    activeSeconds: number;
    empty: boolean;
}

export function buildTimeline(steps: ExampleRecipeStep[]): Timeline {
    let clock = 0;
    let waitingSeconds = 0;

    const entries = steps.map((step, index) => {
        const seconds = step.durationSeconds ?? 0;
        const parallel = PARALLEL_PREFIX.test(step.text) && index > 0;
        const waiting = seconds > 0 && WAITING_VERBS.test(step.text);

        // A parallel step is folded into the step it runs against, so it
        // neither advances the clock nor adds to the total — it is drawn ending
        // where the step it runs alongside ends.
        const startsAt = parallel ? Math.max(0, clock - seconds) : clock;

        if (!parallel) clock += seconds;
        if (waiting && !parallel) waitingSeconds += seconds;

        return {
            stepNumber: step.number,
            title: step.title,
            text: step.text,
            startsAt,
            seconds,
            waiting,
            parallel,
        };
    });

    return {
        entries,
        totalSeconds: clock,
        waitingSeconds,
        activeSeconds: clock - waitingSeconds,
        empty: clock === 0,
    };
}

/** "25 m", "1 h", "2 h 48 m" — a span read as words. */
export function formatSpan(seconds: number): string {
    if (seconds <= 0) return "—";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);

    if (hours === 0) return `${minutes} m`;
    if (minutes === 0) return `${hours} h`;

    return `${hours} h ${minutes} m`;
}

/** "0:00", "1:35" — running position on the axis. */
export function formatClockOffset(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return `${hours}:${String(minutes).padStart(2, "0")}`;
}
