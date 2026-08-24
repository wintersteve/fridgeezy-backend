/**
 * A stopwatch for one request, and the only reason it exists is that nothing
 * else in this app could answer "where did the fifteen seconds go".
 *
 * `logRequestError` covers the case where a turn FAILS. A turn that merely takes
 * a long time produced no record at all, so every latency decision — is the
 * routing call worth downgrading, is persistence actually the blocker, is the
 * p95 near the client's 45s stall timeout — was being made off a reading of the
 * code rather than off numbers.
 *
 * ## It measures spans, not checkpoints
 *
 * The interesting property of this pipeline is which work OVERLAPS. A list of
 * elapsed-since-start checkpoints cannot express that: two stages running
 * concurrently look exactly like two stages running back to back. So a span
 * carries a start and an end, and `summary()` reports both — `at` is when it
 * began, `ms` is how long it took, and a reader can see for themselves that the
 * summary and the persist overlap.
 *
 * ## Failure is not an option it takes
 *
 * Instrumentation that can break the thing it measures is worse than none.
 * `mark`/`measure` never throw, an unclosed span is reported as unclosed rather
 * than guessed at, and `emit` swallows anything the logger does.
 */

export interface TurnSpan {
    /** Milliseconds from the timer's creation to when this span opened. */
    at: number;
    /** Duration, or null while the span is still open. */
    ms: number | null;
}

export interface TurnSummary {
    route: string;
    /** Total milliseconds from construction to `emit`. */
    total: number;
    spans: Record<string, TurnSpan>;
    /** Counters — model calls made, catalogue hits, cache hits. */
    counts: Record<string, number>;
    /** Flags worth grouping by: which path the turn took. */
    labels: Record<string, string>;
}

export class TurnTimer {
    private readonly origin = Date.now();

    private readonly spans = new Map<string, { at: number; end?: number }>();

    private readonly counts = new Map<string, number>();

    private readonly labels = new Map<string, string>();

    constructor(private readonly route: string) {}

    /** Open a span. Re-opening a name replaces it; the last attempt is the one that matters. */
    start(name: string): void {
        this.spans.set(name, { at: Date.now() - this.origin });
    }

    /** Close a span. Silently ignored if it was never opened. */
    end(name: string): void {
        const span = this.spans.get(name);
        if (span) span.end = Date.now() - this.origin;
    }

    /**
     * Time an awaited operation, closing the span even when it throws — a stage
     * that failed still spent its time, and losing that is how the slow path
     * becomes invisible.
     */
    async time<T>(name: string, run: () => Promise<T>): Promise<T> {
        this.start(name);
        try {
            return await run();
        } finally {
            this.end(name);
        }
    }

    count(name: string, by = 1): void {
        this.counts.set(name, (this.counts.get(name) ?? 0) + by);
    }

    label(name: string, value: string): void {
        this.labels.set(name, value);
    }

    /** Milliseconds since the timer was created. */
    elapsed(): number {
        return Date.now() - this.origin;
    }

    summary(): TurnSummary {
        const spans: Record<string, TurnSpan> = {};

        for (const [name, span] of this.spans) {
            spans[name] = {
                at: span.at,
                ms: span.end === undefined ? null : span.end - span.at,
            };
        }

        return {
            route: this.route,
            total: this.elapsed(),
            spans,
            counts: Object.fromEntries(this.counts),
            labels: Object.fromEntries(this.labels),
        };
    }

    /**
     * Write the summary to the log as one JSON line.
     *
     * One line, and machine-shaped, so CloudWatch Logs Insights can aggregate it
     * without a parser: `filter type = "turn_timing" | stats pct(spans.generate.ms, 95)`.
     * The `type` discriminator is what makes that filter possible at all — the
     * log group is shared with every `console.log` in the app.
     */
    emit(): TurnSummary {
        const summary = this.summary();

        try {
            console.log(JSON.stringify({ type: "turn_timing", ...summary }));
        } catch {
            // A summary that cannot be serialised must not take the request with it.
        }

        return summary;
    }
}
