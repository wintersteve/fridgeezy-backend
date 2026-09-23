/**
 * `nx run @fridgeezy/site:serve` — the site, locally, rebuilding as you edit.
 *
 * The console gets this from Vite for free; a static generator has to assemble
 * it, so this is three small pieces:
 *
 *  1. esbuild in WATCH mode, bundling `src/build.ts` (JSX, which node cannot
 *     parse) to `.build/build.cjs`;
 *  2. a re-run of that bundle in a CHILD PROCESS after every rebuild, because
 *     node caches a module graph and `require` would keep handing back the
 *     first render forever;
 *  3. a static server over `dist` that mimics the CloudFront function.
 *
 * ## The rewrite is COPIED FROM PRODUCTION on purpose
 *
 * `infra/site.tf` has a `cloudfront-js-2.0` function turning `/support` into
 * `/support/index.html`, and the build writes subpages as `<name>/index.html`
 * precisely so the links can stay extensionless. A plain static server does not
 * do that — it 404s every page but the landing one — so a local preview without
 * this would disagree with the deployed site about five of its six pages.
 * **Keep the two in step**: if the function in `site.tf` changes, change this.
 *
 * The www 301 and the `/r/<id>` share rewrite are deliberately NOT here. The
 * first needs two hostnames and the second proxies to the API, and neither is
 * something a local preview of the static output can answer.
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import * as esbuild from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const BUNDLE = join(ROOT, ".build", "build.cjs");
const PORT = Number(process.env.PORT || 4300);

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
};

/** Run the freshly-built bundle. A child process, per the note above. */
function render() {
    return new Promise((done) => {
        const started = Date.now();
        const child = spawn(process.execPath, [BUNDLE], { cwd: ROOT, stdio: "inherit" });

        child.on("exit", (code) => {
            console.log(
                code === 0
                    ? `   rendered in ${Date.now() - started}ms`
                    : `   render FAILED (exit ${code}) — the last good dist/ is still being served`
            );
            done();
        });
    });
}

const context = await esbuild.context({
    entryPoints: [join(ROOT, "src", "build.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    conditions: ["@fridgeezy/source"],
    outfile: BUNDLE,
    logLevel: "warning",
    plugins: [
        {
            name: "render-after-build",
            setup(build) {
                build.onEnd(async (result) => {
                    if (result.errors.length) {
                        console.log("   bundle FAILED — dist/ untouched");
                        return;
                    }
                    await render();
                });
            },
        },
    ],
});

await context.watch();

/**
 * The CloudFront rewrite, and then the file. `normalize` before joining is what
 * stops `..` in a request path escaping `dist` — this only ever binds to
 * localhost, but a path traversal in a dev server is still a path traversal.
 */
const server = createServer(async (req, res) => {
    let uri = decodeURIComponent((req.url || "/").split("?")[0]);

    if (!uri.startsWith("/.well-known/")) {
        if (uri.endsWith("/")) uri += "index.html";
        else if (!uri.split("/").pop().includes(".")) uri += "/index.html";
    }

    const path = join(DIST, normalize(uri).replace(/^(\.\.[/\\])+/, ""));

    // `apple-app-site-association` is extensionless, so nothing can be inferred
    // from it — the deploy script sets the type for the whole `.well-known`
    // prefix and this matches, because Apple refuses anything but JSON and a
    // local preview claiming otherwise would hide that.
    const type = uri.startsWith("/.well-known/")
        ? "application/json"
        : TYPES[extname(path)] || "application/octet-stream";

    try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error("not a file");

        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        createReadStream(path).pipe(res);
    } catch {
        // Same as the distribution's custom error response: S3 behind an OAC
        // answers 403 for a missing key, and both map to this page.
        const notFound = join(DIST, "404.html");

        try {
            await stat(notFound);
            res.writeHead(404, { "content-type": TYPES[".html"], "cache-control": "no-store" });
            createReadStream(notFound).pipe(res);
        } catch {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("404");
        }
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  site → http://127.0.0.1:${PORT}  (watching src/, ctrl-c to stop)\n`);
});
