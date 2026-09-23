import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

export interface Resource<T> {
    data: T | undefined;
    error: string | undefined;
    /** True only on the FIRST load. A reload keeps the old rows on screen. */
    loading: boolean;
    /** True while any fetch is in flight, including a reload. */
    fetching: boolean;
    reload: () => void;
}

/**
 * Read something from the API, and be able to read it again.
 *
 * Hand-rolled rather than React Query, which the mobile client uses. The
 * console has no offline story, no persistence, no background refetch and one
 * reader; what it needs is "fetch this, show the old rows while the new ones
 * arrive, and let a mutation say `reload()`". That is this hook, and a cache
 * library here would be a dependency in the backend repo earning one of its
 * features.
 *
 * ## The old data is KEPT across a reload
 *
 * Clearing it would blank a table every time a row is edited, which on a list
 * of fifty is the screen jumping under the cursor. `fetching` is separate from
 * `loading` so the header can show a quiet spinner instead.
 *
 * ## Out-of-order responses are dropped
 *
 * Typing in a search box fires a request per keystroke and they do not come
 * back in order — the classic result is the list settling on the answer to a
 * prefix of what was typed. Each run takes a sequence number and only the
 * newest may write.
 */
export function useResource<T>(
    fetcher: () => Promise<T>,
    deps: readonly unknown[]
): Resource<T> {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<string>();
    const [fetching, setFetching] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [nonce, setNonce] = useState(0);

    const latest = useRef(0);
    // Held in a ref so the effect below does not re-run when the caller passes
    // a new inline closure on every render, which every caller does.
    const fetcherRef = useRef(fetcher);

    fetcherRef.current = fetcher;

    useEffect(() => {
        const run = ++latest.current;

        setFetching(true);

        fetcherRef
            .current()
            .then((result) => {
                if (latest.current !== run) return;

                setData(result);
                setError(undefined);
            })
            .catch((cause: unknown) => {
                if (latest.current !== run) return;

                setError(
                    cause instanceof ApiError
                        ? cause.message
                        : "Something went wrong — check the connection and try again"
                );
            })
            .finally(() => {
                if (latest.current !== run) return;

                setFetching(false);
                setLoaded(true);
            });
        // The caller's own dependency list decides when to refetch; `nonce` is
        // what `reload` bumps. A spread dependency array is what the rule
        // `react-hooks/exhaustive-deps` would object to — and it is not
        // configured in this workspace, so there is deliberately no disable
        // comment here: a suppression for a rule that does not exist is itself
        // an eslint error.
    }, [...deps, nonce]);

    const reload = useCallback(() => setNonce((value) => value + 1), []);

    return { data, error, loading: !loaded, fetching, reload };
}

/**
 * Delay a value, so a search box filters as somebody stops typing rather than
 * as they type.
 *
 * 250ms: under a comfortable typing cadence, so a fast typist fires one request
 * rather than eight, and short enough that it does not read as lag.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);

        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
