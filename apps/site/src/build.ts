import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderCookPage } from "./cook";
import { EXAMPLE_RECIPE } from "./example-recipe";
import { renderFeatureRequestPage } from "./feature-request";
import { renderLandingPage } from "./landing";
import { renderNotFoundPage } from "./not-found";
import { renderPrivacyPage } from "./privacy";
import { renderRecipePage } from "./recipe";
import { renderSupportPage } from "./support";
import { renderTermsPage } from "./terms";
import { appleAppSiteAssociation, assetLinks } from "./well-known";

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
 *
 * `.well-known/` carries the universal-link files. They are written here rather
 * than served by the API because the site holds the apex, which is the origin
 * Apple and Google demand — see `well-known.ts` for the three rules that make
 * them work, all of which fail silently.
 */

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const origin = process.env.SITE_ORIGIN?.replace(/\/+$/, "") || undefined;

const PAGES: Array<{ file: string; html: string }> = [
    { file: "index.html", html: renderLandingPage(origin) },
    { file: "support/index.html", html: renderSupportPage(origin) },
    {
        file: "feature-request/index.html",
        html: renderFeatureRequestPage(origin),
    },
    { file: "privacy/index.html", html: renderPrivacyPage(origin) },
    { file: "terms/index.html", html: renderTermsPage(origin) },
    // One real recipe, so the landing page's "a recipe, not an essay" can be
    // checked rather than taken on faith. Its own file explains why it is a
    // committed fixture and what a page PER recipe would additionally cost.
    {
        file: `recipes/${EXAMPLE_RECIPE.slug}/index.html`,
        html: renderRecipePage(EXAMPLE_RECIPE, origin),
    },
    {
        file: `recipes/${EXAMPLE_RECIPE.slug}/cook/index.html`,
        html: renderCookPage(EXAMPLE_RECIPE, origin),
    },
    { file: "404.html", html: renderNotFoundPage(origin) },
];

rmSync(DIST, { recursive: true, force: true });

for (const { file, html } of PAGES) {
    const target = path.join(DIST, file);

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, html);
}

/**
 * Assets are copied verbatim: the self-hosted fonts, the app screenshots under
 * `screens/` (real captures, light theme only — see `chrome.ts`), and `og.png`,
 * whose source template and re-render command live in `tools/og-template.html`.
 */
cpSync(path.join(ROOT, "src", "assets"), path.join(DIST, "assets"), {
    recursive: true,
});

/**
 * `apple-app-site-association` is extensionless on purpose — that is the name
 * Apple fetches. `assetLinks()` returns null when no signing fingerprint is
 * configured, and an absent file beats a wrong one: Android caches a failed
 * verification, so a placeholder would have to be corrected and then waited out.
 */
const links = assetLinks();

const WELL_KNOWN: Array<{ file: string; json: unknown }> = [
    { file: "apple-app-site-association", json: appleAppSiteAssociation() },
    ...(links ? [{ file: "assetlinks.json", json: links }] : []),
];

mkdirSync(path.join(DIST, ".well-known"), { recursive: true });

for (const { file, json } of WELL_KNOWN) {
    writeFileSync(
        path.join(DIST, ".well-known", file),
        `${JSON.stringify(json, null, 2)}\n`
    );
}

console.log(
    `site → dist: ${PAGES.length} pages + assets` +
        ` · ${WELL_KNOWN.length} well-known` +
        (links ? "" : " (no ANDROID_CERT_SHA256, assetlinks.json omitted)") +
        (origin ? ` · og origin ${origin}` : " · no SITE_ORIGIN, og:image omitted")
);
