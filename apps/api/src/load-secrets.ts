import { writeFileSync } from "node:fs";

import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * Configuration that must exist before any lib is imported.
 *
 * `libs/openai`, `libs/genai` and `libs/supabase` all construct their client at
 * module scope and throw on a missing key, so these are not "read lazily on
 * first use" — they are read the instant the module graph is evaluated. That is
 * what forces the dynamic import in `lambda.ts`.
 */
const REQUIRED_KEYS = [
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Where the Google service-account key is written on Lambda.
 *
 * `/tmp` is the only writable path there, and it survives for the life of the
 * execution environment — so this happens once per cold start, alongside
 * everything else in this file.
 */
const GOOGLE_CREDENTIALS_PATH = "/tmp/google-service-account.json";

/**
 * Turns a service-account JSON held in SSM into the FILE that Google's auth
 * library actually looks for.
 *
 * ## Why this one secret needs code when the other five do not
 *
 * Every parameter under the prefix becomes an env var of the same name, which
 * is all `GOOGLE_API_KEY` or `GOOGLE_CLOUD_PROJECT` needs. Credentials are
 * different: `GOOGLE_APPLICATION_CREDENTIALS` is a PATH, not a value, and
 * `google-auth-library` resolves it by reading the file. Putting the JSON in
 * that variable would leave the library looking for a file whose name is an
 * entire private key, and failing with a path error that names none of this.
 *
 * ## Why the Lambda needs it at all
 *
 * The library's other two sources are gcloud's application-default login and a
 * GCP metadata server. A laptop has the first; anything inside GCP has the
 * second; Lambda has neither. Without this, setting `GOOGLE_CLOUD_PROJECT` on
 * the deployed function would move image generation to Vertex and then fail
 * every render on credentials — so the two belong together, and are documented
 * together in infra/README.md.
 *
 * ## Absent is not an error
 *
 * Unset, this does nothing and image generation stays on `GOOGLE_API_KEY` —
 * which is what every deployed environment did before Vertex existed and what
 * they do until the parameter is written. Same reasoning `imageGenai()` gives
 * for falling back rather than throwing.
 */
function materialiseGoogleCredentials(): void {
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!json) return;

    try {
        writeFileSync(GOOGLE_CREDENTIALS_PATH, json, { mode: 0o600 });

        process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS_PATH;

        // The JSON is removed from the environment once it is on disk. It is a
        // private key, and an env var is the thing most likely to be printed by
        // a stack trace or a debug dump.
        delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

        console.log(
            `[secrets] Google credentials written; images bill to ${
                process.env.GOOGLE_CLOUD_PROJECT ?? "(no GOOGLE_CLOUD_PROJECT — still on the API key)"
            }`
        );
    } catch (cause) {
        // Not fatal. A failed write means image generation falls back to the
        // API key, which is a billing surprise rather than an outage — and
        // taking the whole API down over it would turn one wrong invoice into
        // no service at all.
        console.error("[secrets] could not write Google credentials", cause);
    }
}

let loading: Promise<void> | undefined;

/**
 * Populates `process.env` from SSM Parameter Store, once per execution
 * environment.
 *
 * Terraform used to read these parameters itself and bake the values into the
 * function's environment variables. That worked, but it put five plaintext
 * secrets into the Terraform state file — permanently, and in every historical
 * version of it — so the state file became as sensitive as the secrets and could
 * not go anywhere a state file normally goes. Reading them here instead means
 * the values never leave SSM and never enter state, which is the precondition
 * for moving the backend to S3.
 *
 * Local development does not go through this at all: `SSM_PARAMETER_PREFIX` is
 * unset, `main.ts` loads `dotenv/config`, and this returns immediately. The
 * check is on the prefix rather than on `AWS_LAMBDA_FUNCTION_NAME` so that the
 * path can be exercised from a laptop with credentials.
 */
export function loadSecrets(): Promise<void> {
    // Not cached on failure: a throttled or transient SSM call should be retried
    // by the next invocation rather than poisoning the execution environment for
    // its whole lifetime.
    loading ??= fetchSecrets().catch((error: unknown) => {
        loading = undefined;
        throw error;
    });

    return loading;
}

async function fetchSecrets(): Promise<void> {
    const prefix = process.env.SSM_PARAMETER_PREFIX;

    if (!prefix) {
        return;
    }

    const client = new SSMClient({});
    let nextToken: string | undefined;

    do {
        const page = await client.send(
            new GetParametersByPathCommand({
                Path: prefix,
                WithDecryption: true,
                NextToken: nextToken,
            })
        );

        for (const parameter of page.Parameters ?? []) {
            if (!parameter.Name || parameter.Value === undefined) {
                continue;
            }

            // `/fridgeezy/dev/OPENAI_API_KEY` -> `OPENAI_API_KEY`. The parameter
            // name is the env var name by convention; see infra/put-secrets.sh.
            const key = parameter.Name.slice(parameter.Name.lastIndexOf("/") + 1);

            process.env[key] = parameter.Value;
        }

        nextToken = page.NextToken;
    } while (nextToken);

    // Reported together, and naming the prefix, because the usual cause is a
    // parameter written under the wrong environment. The per-lib throws that
    // would otherwise fire name one key at a time and say nothing about where it
    // was looked for.
    materialiseGoogleCredentials();

    const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(
            `Missing SSM parameters under ${prefix}: ${missing.join(", ")}. ` +
                `Create them with infra/put-secrets.sh.`
        );
    }
}
