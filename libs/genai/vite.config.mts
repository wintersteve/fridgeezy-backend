/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/libs/genai",
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
            name: "@fridgeezy/genai",
            fileName: "index",
            // Change this to the formats you want to support.
            // Don't forget to update your package.json as well.
            formats: ["es" as const],
        },
        rollupOptions: {
            // Vite's default target is the browser, so it resolves node
            // builtins to `__vite-browser-external` and the build dies on the
            // first named import from one. This library only ever runs in the
            // API (local Express and Lambda), so builtins are externalised
            // rather than shimmed — same reason and same fix as libs/bedrock's
            // Smithy/`stream` problem. Nothing in `src` imports one today; this
            // stays so that the next one to arrive does not break the build.
            external: [/^node:/],
        },
    },
}));
