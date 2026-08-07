import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Writes the backend `.env` files, and prints the client's block to stdout.
 *
 * Both halves are DERIVED, never templated, because a template is a copy that
 * goes stale silently:
 *
 * - local  — `supabase status -o json`, so a CLI upgrade that changes the key
 *            format (this one moved from anon JWTs to `sb_publishable_…`) flows
 *            through instead of leaving a stale literal behind.
 * - remote — SSM, which `infra/put-secrets.sh` already treats as the source of
 *            truth for the deployed function. Reading it back closes the loop
 *            and keeps remote secrets out of every committed file.
 *
 * Only the keys listed in MANAGED are rewritten. Anything else already in a
 * `.env` (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `SUPABASE_PROJECT_ID`, whatever
 * you added by hand) is preserved verbatim, so this is safe to re-run and does
 * not require AWS credentials to refresh a local setup.
 */

const MANAGED = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const remote = process.argv.includes("--remote");
const environment = process.env.ENVIRONMENT ?? "dev";
const region = process.env.AWS_REGION ?? "eu-central-1";

/**
 * The address a PHONE should use to reach this machine — never what goes into
 * the backend `.env` files.
 *
 * `localhost` on a physical device means THAT DEVICE, so loopback silently
 * reaches nothing and every request fails with a bare "could not connect". Only
 * the printed client block needs this, and even there it is a convenience: the
 * client's own `npm run start:lan` re-resolves the same address at launch, which
 * is what actually survives a new network or a new DHCP lease.
 */
function hostAddress(): string {
    try {
        const ip = execFileSync("ipconfig", ["getifaddr", "en0"])
            .toString()
            .trim();
        if (ip) return ip;
    } catch {
        // falls through
    }

    console.warn(
        "! Could not read a LAN IP from en0 — falling back to 127.0.0.1.\n" +
            "  That works on a simulator but not on a physical device."
    );
    return "127.0.0.1";
}

/**
 * What the BACKEND writes to its own `.env` — always loopback.
 *
 * The API and every `operations/` script share a machine with the Docker stack,
 * so a LAN IP here bought nothing and broke on every network change. It reaches
 * exactly one consumer, the Supabase client in `libs/supabase`, and that call
 * never leaves the host. The one URL that does reach the phone is built in
 * `create-recipe-image.ts`, which resolves the LAN address itself at request
 * time.
 */
function localValues(): Record<string, string> {
    let raw: string;
    try {
        raw = execFileSync("supabase", ["status", "-o", "json"], {
            stdio: ["ignore", "pipe", "pipe"],
        }).toString();
    } catch {
        console.error(
            "Could not read `supabase status`. Is the local stack running?\n" +
                "  npx nx run @fridgeezy/database:start"
        );
        process.exit(1);
    }

    const status = JSON.parse(raw) as Record<string, string>;

    return {
        SUPABASE_URL: status.API_URL,
        SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
    };
}

function remoteValues(): Record<string, string> {
    const read = (key: string) => {
        try {
            return execFileSync(
                "aws",
                [
                    "ssm",
                    "get-parameter",
                    "--name",
                    `/fridgeezy/${environment}/${key}`,
                    "--with-decryption",
                    "--region",
                    region,
                    "--query",
                    "Parameter.Value",
                    "--output",
                    "text",
                ],
                { stdio: ["ignore", "pipe", "pipe"] }
            )
                .toString()
                .trim();
        } catch {
            console.error(
                `Could not read /fridgeezy/${environment}/${key} from SSM.\n` +
                    "  Check your AWS credentials, or push the parameters with infra/put-secrets.sh."
            );
            process.exit(1);
        }
    };

    return Object.fromEntries(MANAGED.map((key) => [key, read(key)]));
}

/** Rewrite only the managed keys, preserving every other line as-is. */
function merge(path: string, values: Record<string, string>): string {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const lines = existing.split("\n");
    const seen = new Set<string>();

    const merged = lines.map((line) => {
        const match = line.match(/^([A-Z_]+)=/);
        if (!match) return line;

        const key = match[1];
        if (!(key in values)) return line;

        seen.add(key);
        return `${key}="${values[key]}"`;
    });

    const missing = Object.entries(values)
        .filter(([key]) => !seen.has(key))
        .map(([key, value]) => `${key}="${value}"`);

    if (missing.length > 0) {
        merged.push(...missing, "");
    }

    return merged.join("\n");
}

const values = remote ? remoteValues() : localValues();
const label = remote ? `remote (${environment})` : "local";

/**
 * Which files each mode owns.
 *
 * The API's Supabase trio is split by Nx configuration rather than living in one
 * `.env` with the other half commented out. Nx loads `.env.<configuration>`
 * from the project root ahead of `.env` and does not override what it already
 * has, so `serve:dev` reads `.env.dev` and `serve` reads `.env.production`,
 * while the LLM keys stay in the shared `.env` for both. That is what makes
 * "which database am I pointed at" a property of the command you typed instead
 * of a comment you have to remember to swap back.
 *
 * `apps/database/.env` is deliberately absent from the remote list and is only
 * ever written local. Every `operations/` script writes to whatever it says, so
 * a remote value there is one stray `embed-* --all` away from a production
 * incident — and now that `npm run api` is the *production* serve, `env-remote`
 * is a routine command rather than a rare one. The `-remote` database targets
 * do not read it: they go through the linked project.
 */
const targets = remote ? ["../api/.env.production"] : ["../api/.env.dev", ".env"];

for (const target of targets) {
    const path = resolve(process.cwd(), target);
    writeFileSync(path, merge(path, values));
    console.log(`wrote ${label} Supabase config → ${path}`);
}

if (remote) {
    console.log(
        "\napps/database/.env left untouched — it stays pointed at local on purpose.\n" +
            "Remote database work goes through the `-remote` targets, which use the\n" +
            "linked project rather than SUPABASE_URL."
    );
}

// The client is a separate repo, so this is printed rather than written — a
// hardcoded path across repos is exactly the kind of thing that breaks on
// anyone else's machine.
/**
 * The deployed Function URL, straight from Terraform state — the one place that
 * actually knows it. A placeholder here would be copied into a `.env` verbatim
 * and fail as a DNS error, which reads like a network problem rather than an
 * unfilled template.
 */
function deployedBackendUrl(): string {
    try {
        const url = execFileSync(
            "terraform",
            [`-chdir=${resolve(process.cwd(), "../../infra")}`, "output", "-raw", "function_url"],
            { stdio: ["ignore", "pipe", "pipe"] }
        )
            .toString()
            .trim();
        if (url.startsWith("https://")) return `${url.replace(/\/$/, "")}/rest`;
    } catch {
        // falls through
    }

    return "https://<function-id>.lambda-url.eu-central-1.on.aws/rest  # terraform output unavailable";
}

// The client is the only half that needs a device-reachable address, so the LAN
// substitution happens here and nowhere else. The containers bind 0.0.0.0, so
// the ports the CLI reports on loopback answer on the LAN address too.
const clientSupabaseUrl = remote
    ? values.SUPABASE_URL
    : values.SUPABASE_URL.replace("127.0.0.1", hostAddress());

const storage = `${clientSupabaseUrl}/storage/v1/object/public`;
const backend = remote
    ? deployedBackendUrl()
    : `${clientSupabaseUrl.replace(/:\d+$/, ":8000")}/rest`;

console.log(
    [
        "",
        `--- client .env (${label}) — copy into /Users/steve/Projects/fridgeezy/.env ---`,
        `EXPO_PUBLIC_SUPABASE_URL=${clientSupabaseUrl}`,
        `EXPO_PUBLIC_SUPABASE_ANON_KEY=${values.SUPABASE_ANON_KEY}`,
        `EXPO_PUBLIC_SUPABASE_STORAGE_URL=${storage}`,
        `EXPO_PUBLIC_BACKEND_URL=${backend}`,
        "",
        "Expo inlines EXPO_PUBLIC_* at build time — restart with `npx expo start --clear`",
        "or the bundle keeps serving the previous values.",
        ...(remote
            ? []
            : [
                  "",
                  "For local work you can skip this block entirely: `npm run start:dev`",
                  "in the client re-resolves the same LAN address at launch and overrides",
                  "the file, so a new network costs nothing. The client's `.env` is the",
                  "REMOTE config now — paste the `env-remote` block there, not this one.",
              ]),
    ].join("\n")
);
