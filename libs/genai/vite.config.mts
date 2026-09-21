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
            // builtins to `__vite-browser-external` and any import of one dies
            // at build time on a missing export. This library only ever runs in
            // the API (local Express and Lambda), so builtins are externalised
            // rather than shimmed — same reason and same fix as libs/bedrock's
            // Smithy/`stream` problem.
            // `sharp` is a NATIVE module — bundling it produces a build that
            // cannot load its platform binary. It is external for the same
            // reason the builtins above are, and it is a real dependency of
            // this library rather than a peer, because `normaliseGround` is
            // useless without it.
            // `@google/genai` is external for a different reason again, and it
            // is the one with a silent failure. Vite builds this library for
            // the browser, and that package lists its `browser` condition
            // FIRST in `exports` — so bundling it inlined the WEB build, where
            // `vertexai`, `project` and `location` are documented as "ignored
            // on browser runtimes". The options were accepted in silence and
            // the client then failed with "An API Key must be set when running
            // in a browser", which names the one thing a Vertex run
            // deliberately does not have. External, each consumer resolves it
            // under its own conditions — node, in every case this library has
            // — and it is a declared dependency here, so there is nothing for
            // a consumer to install that npm has not already given them.
            external: [
                /^node:/,
                "sharp",
                "thumbhash",
                "@google/genai",
                /^@google\/genai\//,
            ],
        },
    },
}));
