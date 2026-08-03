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

const projectId = process.env.SUPABASE_PROJECT_ID;

if (!useLocal && !projectId) {
    console.error("Missing SUPABASE_PROJECT_ID in .env (or pass --local)");
    process.exit(1);
}

const source = useLocal ? "--local" : `--project-id ${projectId}`;

const outputPath = resolve(
    process.cwd(),
    "../../libs/types/src/lib/database.types.ts"
);

try {
    console.log(
        `Generating types from ${useLocal ? "the LOCAL stack" : `remote project ${projectId}`}…`
    );

    const types = execSync(`supabase gen types typescript ${source}`, {
        stdio: ["ignore", "pipe", "inherit"],
    }).toString();

    writeFileSync(outputPath, types);

    console.log(`Supabase types generated at: ${outputPath}`);
} catch (error) {
    console.error("Failed to generate Supabase types", error);
    process.exit(1);
}
