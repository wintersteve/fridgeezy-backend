import { isAuthDisabled } from "./middleware/require-auth";
import { isReconcileEnabled } from "./modules/billing/services";
import { describeRestEndpoints } from "./rest";
import type { RouteInfo } from "./utils/collect-routes";

/**
 * What the server prints on boot.
 *
 * Two rules shape this: everything is either **derived** (routes come from the
 * routers themselves) or **read from the environment** at print time. Nothing is
 * hand-maintained, because the list this replaced had drifted to four of the ten
 * real endpoints without anyone noticing.
 */

/**
 * Provider line. Read from env rather than importing `@fridgeezy/llm`, because
 * `libs/openai` throws at import when `OPENAI_API_KEY` is unset — a banner must
 * never be the reason a Bedrock-only process fails to boot.
 *
 * No model is shown for OpenAI on purpose: each call site pins its own model
 * (`gpt-4.1`, `gpt-4o`), so a single name here would be wrong for most routes.
 * The Bedrock path really does have one configured model, so it is shown.
 */
function describeProvider(): string {
    const provider = process.env.LLM_PROVIDER ?? "openai";

    if (provider === "bedrock") {
        const model = process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-sonnet-4-6";
        const region = process.env.AWS_REGION ?? "eu-central-1";
        return `bedrock · ${model} · ${region}`;
    }

    return `${provider} · per-call-site models`;
}

/**
 * Whether /rest is gated, read from the environment rather than imported from
 * the middleware, matching the rule above.
 *
 * The disabled case shouts, because it is the state you can be in by accident
 * and it is the one that lets anyone who can reach the port spend the project's
 * LLM credits. /health is outside the gate either way.
 */
function describeAuth(routes: RouteInfo[]): string {
    if (process.env.ALLOW_UNAUTHENTICATED === "true") {
        return "⚠ DISABLED — /rest is open (ALLOW_UNAUTHENTICATED=true)";
    }

    // Counted rather than named: the routes themselves are listed below and
    // marked, and a count is the thing worth noticing if it moves.
    const open = routes.filter((route) => route.isPublic).length;

    return `supabase access token required · ${open} open route${open === 1 ? "" : "s"}`;
}

/**
 * Whether the paid gate is enforcing.
 *
 * Printed unconditionally, and the *off* state is the one that shouts. It used
 * to be off by default — `REQUIRE_ENTITLEMENT` was a rollout switch and this
 * line was the only thing saying so on a server that was neither charging nor
 * counting. The flag is gone (2026-09-04) and the gate is unconditional, so the
 * only way to see the warning now is to have disabled auth, which is a local
 * escape hatch `describeAuth` is already shouting about one line above.
 *
 * The line stays, and prints the counts, for the reason it was written: a gate
 * that came off a route is invisible in a diff and obvious in a number that
 * dropped between boots.
 */
function describeEntitlement(routes: RouteInfo[]): string {
    // Counted from the routing itself, so a premium route that lost its
    // middleware reads as one fewer here on the next boot. The mount `tier` makes
    // an omission fail closed, but it cannot catch a per-route gate that was
    // deleted — see the note on `requireEntitlement`. Zero is worth shouting
    // about while any route is meant to be paid.
    const premium = routes.filter((route) => route.requiresEntitlement).length;
    // Metered routes are counted separately because they are a different claim:
    // a premium route is closed to a free account, a metered one is open to it N
    // times. A drop in either number between boots means a gate came off.
    const metered = routes.filter((route) => route.quotaBucket).length;
    const scope =
        `${premium} premium route${premium === 1 ? "" : "s"}` +
        (metered > 0 ? `, ${metered} metered` : "");

    if (isAuthDisabled()) {
        return `⚠ NOT ENFORCED — ${scope} open to everyone (ALLOW_UNAUTHENTICATED)`;
    }

    if (premium === 0 && metered === 0) {
        return "⚠ enforced, but NO route carries requireEntitlement or requireQuota — nothing is paid or metered";
    }

    // Two independent halves, and the banner names both because their failure
    // modes are opposite and both are silent. Without the webhook secret no
    // event can be RECORDED; without the API key nothing ever RE-ASKS, so a row
    // that is wrong stays wrong until its own expiry — which is what a local
    // stack always looks like, since RevenueCat delivers to one deployed URL.
    const reconcile = isReconcileEnabled()
        ? " · reconciled against RevenueCat"
        : " · webhook only, no reconcile (REVENUECAT_SECRET_API_KEY unset)";

    return process.env.REVENUECAT_WEBHOOK_SECRET
        ? `${scope} · active subscription required${reconcile}`
        : `⚠ ${scope} enforced, but REVENUECAT_WEBHOOK_SECRET is unset — no event can be recorded${reconcile}`;
}

/**
 * No missing-env warning here on purpose: `libs/supabase` and `libs/openai` both
 * throw at *import*, so a process missing either key dies before this banner
 * could print. A check here would be unreachable and imply a safety net that
 * does not exist.
 */
function formatRoutes(routes: RouteInfo[]): string[] {
    const method = (route: RouteInfo) => route.methods.join("|");
    const width = Math.max(...routes.map((route) => method(route).length));
    const pathWidth = Math.max(...routes.map((route) => route.path.length));

    // Only the exceptions are marked — a plain line is the default tier, a
    // signed-in account. That keeps the list readable and puts the attention on
    // the two lines that can be wrong: an unintentionally open route, and a
    // premium route that lost its gate. Both are visible on every boot rather
    // than only in the diff that caused them.
    //
    // The two are mutually exclusive by construction: an open route is on a
    // `publicRouter`, which is mounted ahead of the auth gate, so it can have no
    // entitlement to check.
    //
    // `free` is a third exception and is marked for the same reason as the other
    // two: a route under a metered mount that costs nothing is a claim somebody
    // made, and it should be re-read on every boot rather than only in the diff
    // that made it. Signed in, but no further cost — not the same thing as open.
    return routes.map((route) => {
        const mark = route.isPublic
            ? "  ← open"
            : route.requiresEntitlement
              ? "  ← premium"
              : route.quotaBucket
                ? `  ← metered (${route.quotaBucket})`
                : route.freeReason
                  ? `  ← free (${route.freeReason})`
                  : "";
        const path = mark ? route.path.padEnd(pathWidth) : route.path;

        return `  ${method(route).padEnd(width)}  ${path}${mark}`;
    });
}

export function startupBanner(port: number): string {
    const routes = describeRestEndpoints("/rest");

    return [
        "",
        `  fridgeezy-api ready on http://localhost:${port}`,
        "",
        `  provider  ${describeProvider()}`,
        `  auth      ${describeAuth(routes)}`,
        `  billing   ${describeEntitlement(routes)}`,
        `  runtime   node ${process.version} · ${process.env.NODE_ENV ?? "development"}`,
        `  routes    ${routes.length}`,
        "",
        ...formatRoutes(routes),
        "",
    ].join("\n");
}
