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
    const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(
            `Missing SSM parameters under ${prefix}: ${missing.join(", ")}. ` +
                `Create them with infra/put-secrets.sh.`
        );
    }
}
