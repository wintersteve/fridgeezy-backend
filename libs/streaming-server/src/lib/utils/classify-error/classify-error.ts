import { z } from "zod/v4";

/**
 * Who is responsible for a failure.
 *
 * This is the axis that decides log severity, and later — see
 * `ERROR_STRATEGY.md` — the words the user is shown. It is deliberately not
 * the same axis as {@link ClassifiedError.retryable}: an exhausted provider
 * quota is `service` (our bill, our problem) *and* not retryable, while a
 * provider rate limit is `upstream` and very much is.
 */
export type ErrorFault =
    /** The request was wrong. Retrying it unchanged cannot help. */
    | "client"
    /** We are broken or unpaid. The user can do nothing but wait. */
    | "service"
    /** A dependency is refusing or failing, and may not be next minute. */
    | "upstream";

export interface ClassifiedError {
    /**
     * Stable machine-readable code.
     *
     * The point of stability is that operators alarm on it and, once the
     * frame contract lands, the client branches on it. Renaming one is a
     * breaking change to both.
     */
    code: string;

    /** Who is at fault. Drives log severity. */
    fault: ErrorFault;

    /**
     * Whether an *identical* retry could plausibly succeed.
     *
     * The distinction the current client is missing: a dropped socket is
     * retryable, an exhausted credit balance is not, and offering the same
     * "Try Again" button for both is what makes a quota outage feel like a
     * broken app rather than a temporary one.
     */
    retryable: boolean;
}

/** Reads a property off an unknown throwable without asserting its shape. */
const read = (error: unknown, key: string): unknown =>
    typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)[key]
        : undefined;

const readStatus = (error: unknown): number | undefined => {
    // OpenAI and Anthropic both put it on `status`; node-fetch wrappers and
    // some AWS SDK errors use `statusCode`.
    for (const key of ["status", "statusCode"]) {
        const value = read(error, key);
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }

    return undefined;
};

const readCode = (error: unknown): string => {
    const parts: string[] = [];

    // `code` is OpenAI's specific reason (`credit_balance_exhausted`) and also
    // Node's syscall code (`ECONNRESET`); `type` is OpenAI's broader family
    // (`insufficient_quota`). Match against both, joined, so a rule can key on
    // whichever the provider happened to populate.
    for (const key of ["code", "type", "name"]) {
        const value = read(error, key);
        if (typeof value === "string" && value) parts.push(value);
    }

    return parts.join(" ").toLowerCase();
};

/**
 * Decide what a thrown value actually means.
 *
 * Deliberately does **not** decide the HTTP status — `handleError` still
 * answers exactly what it answered before this module existed. Changing the
 * status is a contract change that the client has to be taught first; see
 * `ERROR_STRATEGY.md`. Today this exists so that a failure is *legible in the
 * logs*, which during the 2026-08-21 quota outage it was not: the highest
 * volume endpoint in the product went fully dark and emitted no ERROR line.
 */
export function classifyError(error: unknown): ClassifiedError {
    // `instanceof` first, then the name. The name check is not belt-and-braces:
    // it fires when the throw crossed a module boundary holding a second copy
    // of zod, where `instanceof` is silently false — `compose-recipe.ts` was
    // already written against `error.name === "ZodError"` for exactly that
    // reason. Getting this wrong is not cosmetic: a malformed body would log at
    // ERROR as `internal_error`, which is the severity an operator is meant to
    // be paged on.
    if (error instanceof z.ZodError || read(error, "name") === "ZodError") {
        return { code: "bad_request", fault: "client", retryable: false };
    }

    const status = readStatus(error);
    const code = readCode(error);

    // Out of money. The sharpest case and the reason this module exists: it
    // arrives as a 429, which every generic rate-limit rule treats as "back
    // off and try again", and no amount of backing off refills a credit
    // balance. It is `service` rather than `upstream` because the provider is
    // working perfectly — we have not paid it.
    if (
        code.includes("insufficient_quota") ||
        code.includes("credit_balance_exhausted") ||
        code.includes("billing")
    ) {
        return {
            code: "provider_quota_exhausted",
            fault: "service",
            retryable: false,
        };
    }

    // A real rate limit: too many requests too fast, and the next one may well
    // land. Only reached when the quota rules above did not match.
    if (status === 429) {
        return {
            code: "provider_rate_limited",
            fault: "upstream",
            retryable: true,
        };
    }

    // Our key is rejected — revoked, rotated without updating SSM, or scoped
    // wrong. Not retryable and not the user's problem, but unlike a quota it
    // means a *deploy-time* mistake rather than an unpaid bill.
    if (status === 401 || status === 403) {
        return {
            code: "provider_auth_failed",
            fault: "service",
            retryable: false,
        };
    }

    // The provider fell over. Genuinely transient more often than not.
    if (typeof status === "number" && status >= 500) {
        return {
            code: "provider_unavailable",
            fault: "upstream",
            retryable: true,
        };
    }

    // Transport-level failures, which on Lambda are usually a provider being
    // slow enough to hit our own socket timeout rather than anything local.
    if (
        code.includes("etimedout") ||
        code.includes("econnreset") ||
        code.includes("econnrefused") ||
        code.includes("enotfound") ||
        code.includes("abort")
    ) {
        return {
            code: "upstream_unreachable",
            fault: "upstream",
            retryable: true,
        };
    }

    // Anything we have not learned to name yet. `service` and retryable is the
    // honest default: we do not know that a retry is hopeless, and we do know
    // it is not the user's fault.
    return { code: "internal_error", fault: "service", retryable: true };
}
