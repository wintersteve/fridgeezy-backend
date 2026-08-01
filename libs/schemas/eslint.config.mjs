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
                    // vite is build tooling, not a runtime dependency. This
                    // package is packed and installed into the React Native
                    // client, so anything listed under `dependencies` is
                    // installed by the app — the built bundle imports neither
                    // vite nor tslib, and adding them to satisfy the rule would
                    // ship a bundler to a phone.
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
