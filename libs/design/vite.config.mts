/// <reference types='vitest' />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/libs/design",
    plugins: [
        // The lib ships components, so JSX has to be transformed here as well
        // as in each consumer.
        react(),
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
            name: "@fridgeezy/toolkit",
            fileName: "index",
            // Change this to the formats you want to support.
            // Don't forget to update your package.json as well.
            formats: ["es" as const],
        },
        rollupOptions: {
            // External packages that should not be bundled into your library.
            // React, MUI and emotion stay EXTERNAL: bundling them would give a
            // consumer a second React and a second emotion cache, and two
            // emotion caches mean two copies of every rule in the document.
            external: [
                "react",
                "react/jsx-runtime",
                "react-dom",
                /^@mui\//,
                /^@emotion\//,
            ],
        },
    },
}));
