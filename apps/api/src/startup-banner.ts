import { describeRestEndpoints } from "./api/v1";
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
 * No missing-env warning here on purpose: `libs/supabase` and `libs/openai` both
 * throw at *import*, so a process missing either key dies before this banner
 * could print. A check here would be unreachable and imply a safety net that
 * does not exist.
 */
function formatRoutes(routes: RouteInfo[]): string[] {
    const method = (route: RouteInfo) => route.methods.join("|");
    const width = Math.max(...routes.map((route) => method(route).length));

    return routes.map((route) => `  ${method(route).padEnd(width)}  ${route.path}`);
}

export function startupBanner(port: number): string {
    const routes = describeRestEndpoints("/rest");

    return [
        "",
        `  fridgeezy-api ready on http://localhost:${port}`,
        "",
        `  provider  ${describeProvider()}`,
        `  runtime   node ${process.version} · ${process.env.NODE_ENV ?? "development"}`,
        `  routes    ${routes.length}`,
        "",
        ...formatRoutes(routes),
        "",
    ].join("\n");
}
