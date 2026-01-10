import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

config();

const projectId = process.env.SUPABASE_PROJECT_ID;

if (!projectId) {
    console.error("Missing SUPABASE_PROJECT_ID in .env");
    process.exit(1);
}

const outputPath = resolve(
    process.cwd(),
    "../../libs/supabase/src/lib/modules/client/database.types.ts"
);

try {
    const types = execSync(
        `supabase gen types typescript --project-id ${projectId}`,
        { stdio: ["ignore", "pipe", "inherit"] }
    ).toString();

    writeFileSync(outputPath, types);

    console.log(`Supabase types generated at: ${outputPath}`);
} catch (error) {
    console.error("Failed to generate Supabase types", error);
    process.exit(1);
}
