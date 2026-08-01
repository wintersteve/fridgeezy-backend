import baseConfig from "../../eslint.base.config.mjs";

export default [
    ...baseConfig,
    {
        files: ["**/*.json"],
        rules: {
            "@nx/dependency-checks": [
                "error",
                {
                    ignoredFiles: [
                        "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
                        // The eval harness is developer tooling, not part of the
                        // deployed app: nothing reachable from main.ts imports
                        // it, and `npm ci --omit=dev` leaves its dependencies
                        // out of the Lambda artifact. Checking it here would
                        // force ~5MB of AWS SDK into `dependencies` to satisfy
                        // code that never runs in production.
                        "{projectRoot}/src/evals/**",
                    ],
                },
            ],
        },
        languageOptions: {
            parser: await import("jsonc-eslint-parser"),
        },
    },
];
