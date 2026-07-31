/**
 * Registry for work that is started deliberately without being awaited by the
 * request handler — currently recipe image generation, which is kicked off as
 * soon as the dish name is known so it overlaps the recipe stream.
 *
 * On a long-running server these settle on their own after the response is sent.
 * On Lambda they do not: the execution environment is frozen the moment the
 * handler returns, so an unawaited promise can be suspended mid-flight and only
 * resume on some later, unrelated invocation — or never. `lambda.ts` drains this
 * registry after the response stream closes but before returning, which keeps
 * the client's latency unchanged while still letting the upload finish.
 */

const pending = new Set<Promise<void>>();

const ignore = (): void => undefined;

/**
 * Registers a fire-and-forget promise and returns it unchanged, so callers keep
 * attaching their own `.catch()` for logging.
 */
export function trackBackgroundTask<T>(task: Promise<T>): Promise<T> {
    // Tracked separately from the returned promise: this copy never rejects, so
    // draining it cannot surface an unhandled rejection or mask the caller's own
    // error handling.
    const tracked = task.then(ignore, ignore);

    pending.add(tracked);
    void tracked.then(() => {
        pending.delete(tracked);
    });

    return task;
}

export function pendingBackgroundTaskCount(): number {
    return pending.size;
}

/**
 * Waits for every tracked task to settle.
 *
 * Re-checks after each batch because a draining task can register another one.
 * Returns false if the budget ran out first — the caller decides whether that is
 * worth reporting.
 */
export async function settleBackgroundTasks(budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs;

    while (pending.size > 0) {
        const remaining = deadline - Date.now();

        if (remaining <= 0) {
            return false;
        }

        const batch = Promise.all([...pending]).then(() => true);
        const expiry = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), remaining);

            // Do not hold the event loop open purely to observe the deadline.
            timer.unref?.();
        });

        if (!(await Promise.race([batch, expiry]))) {
            return false;
        }
    }

    return true;
}
