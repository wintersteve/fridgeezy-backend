import { supabase } from "./supabase";

/**
 * One fetch wrapper for the whole console.
 *
 * ## The token is taken per request, never captured
 *
 * `getSession()` refreshes an expired access token, so a console left open over
 * lunch works on the next click instead of answering 401. Holding the token in
 * a module variable is the version of this that appears to work and then
 * quietly stops.
 *
 * ## A 404 from this API means "not an admin"
 *
 * `requireAdmin` answers a non-admin with 404 rather than 403, deliberately —
 * there is nothing for them to act on and nothing to gain by confirming the
 * surface exists. That means a genuine missing row and a refusal look the same
 * from here, which is a fair trade for one screen: the console tells the reader
 * their account is not an admin when the OVERVIEW 404s, because that route
 * always exists.
 */
const baseUrl = import.meta.env.VITE_BACKEND_URL;

if (!baseUrl) {
    throw new Error("VITE_BACKEND_URL must be set at build time");
}

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

async function request<T>(
    path: string,
    init?: RequestInit & { json?: unknown }
): Promise<T> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
        throw new ApiError(401, "Signed out");
    }

    const { json, ...rest } = init ?? {};

    const response = await fetch(`${baseUrl}/admin${path}`, {
        ...rest,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
            ...rest.headers,
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

    if (!response.ok) {
        // The API answers every failure with `{ error }`. A body that is not
        // JSON at all means something in front of the API answered — a
        // CloudFront error page, a proxy — and the status is the only honest
        // thing left to report.
        const message = await response
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => undefined);

        throw new ApiError(response.status, message ?? `Request failed (${response.status})`);
    }

    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
}

/**
 * Build a query string, dropping anything unset.
 *
 * `undefined` and `""` are both "no filter" from a form's point of view, and
 * sending either as a literal makes the server validate an empty string as a
 * value. `false` is kept — it is an answer.
 */
export function queryString(params: Record<string, unknown>): string {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        search.set(key, String(value));
    }

    const rendered = search.toString();

    return rendered ? `?${rendered}` : "";
}

export const api = {
    get: <T>(path: string) => request<T>(path),
    patch: <T>(path: string, json: unknown) => request<T>(path, { method: "PATCH", json }),
    put: <T>(path: string, json: unknown) => request<T>(path, { method: "PUT", json }),
    post: <T>(path: string, json?: unknown) => request<T>(path, { method: "POST", json: json ?? {} }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
