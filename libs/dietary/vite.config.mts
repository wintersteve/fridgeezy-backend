/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/libs/dietary",
    plugins: [
        dts({
            entryRoot: "src",
            tsconfigPath: path.join(import.meta.dirname, "tsconfig.lib.json"),
        }),
    ],
    // Uncomment this if you are using workers.
    // worker: {
    //  plugins: [],
    // },
    // Configuration for building your library.
    // See: https://vite.dev/guide/build.html#library-mode
    build: {
        outDir: "./dist",
        emptyOutDir: true,
        reportCompressedSize: true,
        commonjsOptions: {
            transformMixedEsModules: true,
        },
        lib: {
            // Could also be a dictionary or array of multiple entry points.
            entry: "src/index.ts",
            name: "@fridgeezy/dietary",
            fileName: "index",
            // Change this to the formats you want to support.
            // Don't forget to update your package.json as well.
            formats: ["es" as const],
        },
        rollupOptions: {
            // Left to bundle, `@fridgeezy/llm` drags in the Bedrock client and
            // rollup dies inside Smithy's event-stream codec — the same failure
            // libs/llm itself avoids by externalising its two providers. This
            // library is a prompt and a parser; the workspace packages stay
            // external and are resolved by the consumer.
            external: [
                "@fridgeezy/llm",
                "@fridgeezy/toolkit",
                "@fridgeezy/types",
            ],
        },
    },
}));
