import type { SortDirection } from "@fridgeezy/admin-contract";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The filters, the sort and the page, all read from and written to the URL.
 *
 * Every list page had its own copy of `setParam` — identical in six files,
 * including the two rules below, which is exactly how one of them ends up
 * without the offset reset and nobody notices until page four of a list that
 * now has one page shows an empty table.
 *
 * The URL rather than component state, so the Overview's "3 dishes have no
 * picture" tile can link straight to a narrowed list, and so a filtered view
 * survives a reload.
 */
/**
 * Narrowed rather than cast, so a hand-typed `?dir=sideways` falls back to the
 * list's own default instead of being sent to an API that answers a validation
 * error for a parameter the reader never chose.
 */
function readDirection(value: string | null, fallback: SortDirection): SortDirection {
    return value === "asc" || value === "desc" ? value : fallback;
}

export function useListParams(defaults: {
    sort: string;
    dir: SortDirection;
    /**
     * Params a narrowing invalidates, beyond the page number.
     *
     * The step-art screen opens a dish's method BELOW its list, so `?recipe=`
     * has to go when the list changes: the row it came from may not be in the
     * new result at all, and a method panel under a list that no longer holds
     * it reads as a bug. Declared here rather than in a second copy of
     * `setParam`, so the SORT obeys the same rule — which the page's own copy
     * did not, sorting having been a select outside it.
     */
    clearOnChange?: readonly string[];
}) {
    const [params, setParams] = useSearchParams();
    const clearOnChange = defaults.clearOnChange;

    const narrow = useCallback(
        (apply: (next: URLSearchParams) => void) => {
            const next = new URLSearchParams(params);

            apply(next);

            // Any change but paging returns to the first page: staying on page
            // four of a narrower list shows nothing and reads as "no results".
            next.delete("offset");

            for (const key of clearOnChange ?? []) next.delete(key);

            // `replace`, so filtering does not fill the back button with every
            // keystroke of a search term.
            setParams(next, { replace: true });
        },
        [clearOnChange, params, setParams]
    );

    const setParam = useCallback(
        (key: string, value: string | null) => {
            if (key === "offset") {
                const next = new URLSearchParams(params);

                if (value === null || value === "") next.delete(key);
                else next.set(key, value);

                setParams(next, { replace: true });

                return;
            }

            narrow((next) => {
                if (value === null || value === "") next.delete(key);
                else next.set(key, value);
            });
        },
        [narrow, params, setParams]
    );

    const setSort = useCallback(
        (column: string, dir: SortDirection) =>
            narrow((next) => {
                next.set("sort", column);
                next.set("dir", dir);
            }),
        [narrow]
    );

    return {
        params,
        /** For a page that writes a param the helpers above do not cover. */
        setParams,
        setParam,
        setSort,
        get: (key: string, fallback = "") => params.get(key) ?? fallback,
        sort: params.get("sort") ?? defaults.sort,
        dir: readDirection(params.get("dir"), defaults.dir),
        offset: Number(params.get("offset") ?? 0),
    };
}
