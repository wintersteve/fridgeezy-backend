import { PROSE_CSS, renderPage, SITE_NAME } from "./chrome";

/**
 * The 404 page, served by CloudFront's custom error responses (S3 behind an
 * Origin Access Control answers 403 for a missing key, so both 403 and 404 map
 * here — see `infra/site.tf`).
 */

const BODY = `
<main class="prose">
  <h1>Nothing simmering here</h1>
  <p class="lede">This page doesn't exist — maybe the link went stale.</p>
  <p><a href="/">Back to ${SITE_NAME}</a></p>
</main>
`;

export function renderNotFoundPage(origin?: string): string {
    return renderPage({
        title: `Page not found — ${SITE_NAME}`,
        description: `This page doesn't exist.`,
        origin,
        path: "/404.html",
        styles: PROSE_CSS,
        body: BODY,
    });
}
