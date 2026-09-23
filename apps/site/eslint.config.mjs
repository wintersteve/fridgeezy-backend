import baseConfig from "../../eslint.base.config.mjs";

export default [
    // The esbuild bundle the build writes on its way to `dist` — forty thousand
    // lines of vendored React and MUI. `**/dist` is ignored by the base config
    // for the same reason; this directory is the same kind of thing and only
    // exists because JSX has to be transformed before node can run the build.
    { ignores: ["**/.build"] },
    ...baseConfig,
    {
        files: ["**/*.json"],
        rules: {
            "@nx/dependency-checks": [
                "error",
                {
                    ignoredFiles: [
                        "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
                    ],
                },
            ],
        },
        languageOptions: {
            parser: await import("jsonc-eslint-parser"),
        },
    },
];
