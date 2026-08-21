/**
 * The plumbing that lets one async generator be fed by several producers.
 *
 * `generateSuggestionsStream` has three things happening at once — the model's
 * lines being read, dishes being admitted in whatever order their gate calls
 * return, and cards being emitted in generation order — and a generator can only
 * `yield` from its own body. So the producers push here and the generator drains.
 *
 * Its own module, with NO imports, for the same reason `suggestion-reveals.ts`
 * is: everything else in this directory pulls in `@fridgeezy/supabase`, which
 * constructs its client at module scope and throws on a missing key. Kept
 * separate, this can be exercised with no database, no API key and no spend —
 * which matters because what it protects is a CONCURRENCY property, and one that
 * holds "usually" is indistinguishable from one that holds.
 */

/**
 * A re-armable latch: `next()` resolves on the following `open()`.
 *
 * **Call `next()` in the same synchronous turn as the test that decided to
 * wait.** Anything awaited in between gives a producer the chance to `open()`
 * against nobody, and the waiter then sleeps through the signal it wanted.
 */
export function createGate() {
    let release: (() => void) | null = null;

    return {
        next(): Promise<void> {
            return new Promise<void>((resolve) => {
                // Chained rather than overwritten: several readers may be
                // waiting, and dropping the previous one strands it forever.
                const waiting = release;

                release = () => {
                    waiting?.();
                    resolve();
                };
            });
        },
        open() {
            const waiting = release;
            release = null;
            waiting?.();
        },
    };
}

export interface FrameQueue<T> {
    push(item: T): void;
    /** No more frames are coming; an in-progress `drain()` ends cleanly. */
    close(): void;
    drain(): AsyncGenerator<T>;
}

/** Frames from several producers, drained by one generator in push order. */
export function createFrameQueue<T>(): FrameQueue<T> {
    const items: T[] = [];
    const arrivals = createGate();
    let closed = false;

    return {
        push(item: T) {
            items.push(item);
            arrivals.open();
        },
        close() {
            closed = true;
            arrivals.open();
        },
        async *drain(): AsyncGenerator<T> {
            for (;;) {
                // `yield` suspends, so more can arrive mid-loop — the length is
                // re-tested each time rather than read once into a bound.
                while (items.length > 0) yield items.shift() as T;

                if (closed) return;

                await arrivals.next();
            }
        },
    };
}
