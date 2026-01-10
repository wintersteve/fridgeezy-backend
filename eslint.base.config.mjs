import nx from "@nx/eslint-plugin";
import importPlugin from "eslint-plugin-import";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
        ignores: ["**/dist", "**/out-tsc"],
    },
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
        plugins: {
            import: importPlugin,
        },
        settings: {
            "import/resolver": {
                node: true,
            },
        },
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"],
                    depConstraints: [
                        {
                            sourceTag: "scope:app",
                            onlyDependOnLibsWithTags: ["scope:shared"],
                        },
                        {
                            sourceTag: "scope:shared",
                            onlyDependOnLibsWithTags: ["scope:shared"],
                        },
                    ],
                },
            ],
            "@typescript-eslint/no-explicit-any": "off",
            "import/order": [
                "error",
                {
                    groups: [
                        "builtin",
                        "external",
                        "internal",
                        "parent",
                        "sibling",
                        "index",
                    ],
                    "newlines-between": "always",
                    alphabetize: {
                        order: "asc",
                        caseInsensitive: true,
                    },
                },
            ],
            "import/no-unresolved": [
                "error",
                {
                    ignore: ["^\\.\\.?/"], // Ignore relative imports - TypeScript handles these
                },
            ],
            "import/no-duplicates": "error",
        },
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs",
        ],
        // Override or add rules here
        rules: {},
    },
];
