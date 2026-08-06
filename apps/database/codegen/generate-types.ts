import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

config();

// `--local` reads the running local stack; the default reads the linked remote
// project. This matters more than it looks: with a local stack you write a
// migration, apply it locally, then regenerate — and against the remote you
// would get types for a schema WITHOUT your migration, with nothing failing to
// say so. Whichever database you just changed is the one to generate from.
const useLocal = process.argv.includes("--local");

// Only for the log line — `--linked` resolves the project from the CLI's own
// link state, so this is no longer required for the command to work.
const projectId = process.env.SUPABASE_PROJECT_ID;

/**
 * A direct Postgres connection string. Optional, and the only escape hatch from
 * the platform.
 *
 * Both remote flags — `--project-id` and `--linked` — introspect through
 * Supabase's hosted pg-meta service, so both go down together the moment the
 * project trips a quota: a cached-egress cap left `gen types` answering
 * "Service for this project is restricted" while `migration up --linked` was
 * still applying migrations against the same database perfectly happily. Only
 * `--db-url` skips the platform and runs the introspection queries itself.
 *
 * Set `SUPABASE_DB_URL` in apps/database/.env to the connection string from
 * Settings → Database to make that the default.
 */
const dbUrl = process.env.SUPABASE_DB_URL;

// `--linked` over `--project-id` for the fallback: same route, but it takes the
// project from the CLI's link state rather than needing the id in .env, so it
// cannot disagree with the database the migrations were just applied to.
const source = useLocal
    ? "--local"
    : dbUrl
      ? `--db-url '${dbUrl}'`
      : "--linked";

const outputPath = resolve(
    process.cwd(),
    "../../libs/types/src/lib/database.types.ts"
);

try {
    const target = useLocal
        ? "the LOCAL stack"
        : dbUrl
          ? "the database at SUPABASE_DB_URL"
          : `the linked project${projectId ? ` (${projectId})` : ""}`;

    console.log(`Generating types from ${target}…`);

    const types = execSync(`supabase gen types typescript ${source}`, {
        stdio: ["ignore", "pipe", "inherit"],
    }).toString();

    // The CLI has been known to exit 0 with nothing on stdout. Writing that
    // would replace the checked-in types with an empty file and break both
    // repos, so the output has to look like types before it is trusted.
    if (!types.includes("export type Database")) {
        console.error(
            "Refusing to write: the CLI returned no Database type. Left the existing file alone."
        );
        process.exit(1);
    }

    writeFileSync(outputPath, types);

    console.log(`Supabase types generated at: ${outputPath}`);
} catch (error) {
    console.error("Failed to generate Supabase types", error);
    process.exit(1);
}
