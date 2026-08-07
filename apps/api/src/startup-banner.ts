import { isEntitlementRequired } from "./middleware/require-entitlement";
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
 * Printed unconditionally, and the *off* state is the one that shouts — the
 * opposite of `describeAuth`, matching the inverted default in
 * `require-entitlement.ts`. The gate has to ship disabled (the client cannot
 * sell a subscription yet) which means "off" is both the correct state today and
 * the state that silently costs money once it stops being correct. Something has
 * to say so on every boot.
 */
function describeEntitlement(): string {
    if (!isEntitlementRequired()) {
        return "⚠ NOT ENFORCED — every signed-in user gets full access (REQUIRE_ENTITLEMENT unset)";
    }

    return process.env.REVENUECAT_WEBHOOK_SECRET
        ? "active subscription required"
        : "⚠ enforced, but REVENUECAT_WEBHOOK_SECRET is unset — no event can be recorded";
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

    // Open routes are marked, gated ones are not. Marking the exception keeps the
    // list readable and puts the attention on the line that can be wrong — an
    // unintentionally open route is visible on every boot rather than only in
    // the diff that opened it.
    return routes.map((route) => {
        const open = route.isPublic ? "  ← open" : "";
        const path = open ? route.path.padEnd(pathWidth) : route.path;

        return `  ${method(route).padEnd(width)}  ${path}${open}`;
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
        `  billing   ${describeEntitlement()}`,
        `  runtime   node ${process.version} · ${process.env.NODE_ENV ?? "development"}`,
        `  routes    ${routes.length}`,
        "",
        ...formatRoutes(routes),
        "",
    ].join("\n");
}
