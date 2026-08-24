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
                        "{projectRoot}/vite.config.{js,ts,mjs,mts}",
                    ],
                    // vite is the bundler, not something the built package
                    // imports. Left in `dependencies` it was installed into the
                    // Lambda artifact by `npm ci --omit=dev`.
                    ignoredDependencies: ["vite"],
                },
            ],
        },
        languageOptions: {
            parser: await import("jsonc-eslint-parser"),
        },
    },
    {
        ignores: ["**/out-tsc"],
    },
];