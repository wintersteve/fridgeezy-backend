import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderLandingPage } from "./landing";
import { renderNotFoundPage } from "./not-found";
import { renderPrivacyPage } from "./privacy";
import { renderSupportPage } from "./support";
import { renderTermsPage } from "./terms";

/**
 * Static export: renders every page into `dist/` ready for `aws s3 sync`.
 *
 * Subpages are written as `<name>/index.html` rather than `<name>.html` so the
 * links stay extensionless (`/support`); the CloudFront function in
 * `infra/site.tf` rewrites those request paths to the index object. `404.html`
 * sits at the root because CloudFront's custom error response points there.
 *
 * `SITE_ORIGIN` (e.g. `https://dxxxx.cloudfront.net`, no trailing slash) makes
 * Open Graph URLs absolute — crawlers don't resolve relative `og:image`
 * values. Without it the pages are still valid, just without preview images;
 * `infra/deploy-site.sh` passes it from `terraform output`, so a hand-run
 * build differing from a deployed one in exactly this one way is expected.
 */

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const origin = process.env.SITE_ORIGIN?.replace(/\/+$/, "") || undefined;

const PAGES: Array<{ file: string; html: string }> = [
    { file: "index.html", html: renderLandingPage(origin) },
    { file: "support/index.html", html: renderSupportPage(origin) },
    { file: "privacy/index.html", html: renderPrivacyPage(origin) },
    { file: "terms/index.html", html: renderTermsPage(origin) },
    { file: "404.html", html: renderNotFoundPage(origin) },
];

rmSync(DIST, { recursive: true, force: true });

for (const { file, html } of PAGES) {
    const target = path.join(DIST, file);

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, html);
}

cpSync(path.join(ROOT, "src", "assets"), path.join(DIST, "assets"), {
    recursive: true,
});

console.log(
    `site → dist: ${PAGES.length} pages + assets` +
        (origin ? ` · og origin ${origin}` : " · no SITE_ORIGIN, og:image omitted")
);
