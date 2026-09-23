import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The console's build.
 *
 * ## `resolve.conditions` is the load-bearing line
 *
 * Workspace libs here publish a `@fridgeezy/source` export condition pointing
 * at their TypeScript, which is how `tsconfig.base.json` resolves them without
 * a paths map. Vite does not read that tsconfig, so without this it would
 * resolve `@fridgeezy/admin-contract` to `dist` — and the console would build
 * against whatever was last compiled rather than against the contract in the
 * tree. The symptom is a field that exists in the source and is missing at
 * runtime, which reads as a server bug.
 *
 * The defaults have to be repeated: setting `conditions` REPLACES the list
 * rather than extending it, and dropping `import`/`module`/`default` breaks
 * every ordinary package.
 */
export default defineConfig({
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/apps/admin",
    plugins: [react()],
    resolve: {
        conditions: ["@fridgeezy/source", "browser", "module", "import", "default"],
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // Filenames are content-hashed by default, which is what lets the
        // deploy script cache assets hard and the page not at all.
        sourcemap: true,
    },
    server: {
        port: 4300,
    },
});
