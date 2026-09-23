/** Dates the console shows are absolute — a curator is reading a log, not a feed. */
export function formatDate(iso: string | null): string {
    if (!iso) return "—";

    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

export function formatDateTime(iso: string | null): string {
    if (!iso) return "—";

    return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatMinutes(minutes: number | null): string {
    if (minutes === null) return "—";
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * A cache-busting URL for an image the console has just replaced.
 *
 * The storage path is derived from the dish's NAME, so a regenerated picture
 * lands at the same URL the browser is already holding. The parameter is added
 * here and never written to `recipes.image`: the thumbhash write keys on the
 * canonical URL, so a versioned one in that column would silently stop
 * matching. See `regenerate-recipe-image.ts`.
 */
export function bustCache(url: string | null, token: number): string | undefined {
    if (!url) return undefined;
    if (!token) return url;

    return `${url}${url.includes("?") ? "&" : "?"}v=${token}`;
}
