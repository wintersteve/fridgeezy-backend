/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
    root: import.meta.dirname,
    cacheDir: "../../../node_modules/.vite/libs/fridgeezy/types",
    plugins: [
        dts({
            entryRoot: "src",
            tsconfigPath: path.join(import.meta.dirname, "tsconfig.lib.json"),
            exclude: ["vite.config.mts"],
        }),
    ],
    build: {
        outDir: "./dist",
        emptyOutDir: true,
        reportCompressedSize: true,
        commonjsOptions: {
            transformMixedEsModules: true,
        },
        lib: {
            entry: "src/index.ts",
            name: "@fridgeezy/types",
            fileName: "index",
            formats: ["es" as const],
        },
        rollupOptions: {
            external: ["zod"],
        },
    },
}));
