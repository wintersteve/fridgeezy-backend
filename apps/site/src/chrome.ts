/**
 * Shared page chrome for the public site: design tokens, fonts, nav and footer.
 *
 * Every value in `TOKENS_CSS` is lifted from the app's design system
 * (`fridgeezy/src/shared/theme/constants`) rather than invented here — the site
 * has to read as the same product as the app, and the app is the source of
 * truth. When a token changes there, change it here; the comment on each block
 * names the source. The two derived values (the tertiary washes) are marked as
 * such: the app never needed them because `useCategoryPalette` composites its
 * washes at runtime.
 *
 * Fonts are self-hosted from `/assets/fonts` instead of the Google Fonts CDN —
 * loading fonts from Google's servers leaks visitor IPs to a third party, which
 * the LG München ruling treats as a GDPR violation. The subsets match what the
 * app loads through `@expo-google-fonts`: Poppins at the four working weights
 * and Lora's semibold italic, which exists for exactly one job in both places —
 * the rotating word in the welcome headline.
 */

export const SITE_NAME = "Fridgeezy";
export const SUPPORT_EMAIL = "support@wintersteve.com";

/**
 * A small favicon drawn inline: the app icon's overhead bowl, reduced to a
 * peach squircle holding a white arc. Inline data URI so the site ships no
 * binary icon asset and every page carries it in one place.
 */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#F4A67A"/><circle cx="32" cy="30" r="15" fill="none" stroke="#FFFFFF" stroke-width="5"/><path d="M14 36h36a18 18 0 0 1-36 0z" fill="#FFFFFF"/></svg>`
)}`;

const FONTS_CSS = `
@font-face{font-family:'Poppins';font-style:normal;font-weight:400;font-display:swap;src:url(/assets/fonts/poppins-400.woff2) format('woff2')}
@font-face{font-family:'Poppins';font-style:normal;font-weight:500;font-display:swap;src:url(/assets/fonts/poppins-500.woff2) format('woff2')}
@font-face{font-family:'Poppins';font-style:normal;font-weight:600;font-display:swap;src:url(/assets/fonts/poppins-600.woff2) format('woff2')}
@font-face{font-family:'Poppins';font-style:normal;font-weight:700;font-display:swap;src:url(/assets/fonts/poppins-700.woff2) format('woff2')}
@font-face{font-family:'Lora';font-style:italic;font-weight:600;font-display:swap;src:url(/assets/fonts/lora-600-italic.woff2) format('woff2')}
`;

/**
 * Light values: `COLORS.LIGHT` + `COLORS.COMMON`. Dark: `COLORS.DARK`. Shadows
 * are the `SHADOWS` recipes as CSS box-shadows (shadow colour `COMMON.black`,
 * kept across themes — "a shadow is cast regardless of the palette"). Radii are
 * the `RADIUS` scale.
 */
const TOKENS_CSS = `
:root{
  --bg:#FDFBF9;--bg-variant:#FAF8F6;--surface:#FFFFFF;
  --ink:#5C5450;--ink-strong:#3A332F;--ink-muted:#9A938F;--ink-soft:#8A8380;--ink-mid:#7A736F;
  --outline:rgba(232,228,224,.5);--outline-solid:#E8E4E0;
  --primary:#F4A67A;--on-primary:#FFFFFF;--primary-container:#FFF5EE;--primary-ink:#A35529;
  --secondary:#93C5A8;--secondary-container:#F0F7F2;--secondary-ink:#3F7A58;
  --on-secondary-container:#1D192B;
  --rose-container:#FFF3F0;--rose-ink:#6E3733;
  --tertiary-ink:#3C6B81;--tertiary-container:#EEF4F8;/* derived wash, see header */
  --shadow-rest:0 4px 4px rgba(6,6,6,.0125);
  --shadow-raised:0 2px 8px rgba(6,6,6,.06);
  --shadow-floating:0 6px 16px rgba(6,6,6,.06);
  --r-md:8px;--r-lg:12px;--r-xl:16px;--r-xxl:28px;--r-pill:999px;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#141110;--bg-variant:#1B1715;--surface:#26201C;
  --ink:#EFE7DD;--ink-strong:#F7F1E8;--ink-muted:#A79C91;--ink-soft:#B0A599;--ink-mid:#C4B9AC;
  --outline:rgba(239,231,221,.14);--outline-solid:#423C37;
  --on-primary:#2E1808;--primary-container:#33241B;--primary-ink:#F0B084;
  --secondary-container:#1F2B24;--secondary-ink:#A3D3B7;
  --on-secondary-container:#D8E8DE;
  --rose-container:#34201D;--rose-ink:#EFB2AC;
  --tertiary-ink:#A0C7DA;--tertiary-container:#1C272D;/* derived wash, see header */
}}
`;

/**
 * Base styles shared by every page: reset, the type scale (the `FONTS` variants
 * the site uses, at their exact metrics), and the shared nav/footer chrome.
 */
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  font-family:'Poppins',-apple-system,system-ui,sans-serif;
  font-size:16px;line-height:1.5;letter-spacing:.15px;
  background:var(--bg);color:var(--ink);
  /* decorative elements (the phone's backdrop washes) may exceed the
     viewport; clip instead of letting phones pan sideways */
  overflow-x:clip;
}
img{display:block;max-width:100%}
a{color:inherit}
.container{max-width:1120px;margin:0 auto;padding:0 24px}

.wordmark{
  font-weight:600;font-size:13px;letter-spacing:.22em;
  color:var(--ink-strong);text-decoration:none;
}
.site-nav{padding:28px 0}
.site-nav .container{display:flex;align-items:center;justify-content:space-between}
.site-nav a.quiet{
  font-weight:500;font-size:14px;letter-spacing:.1px;
  color:var(--ink-mid);text-decoration:none;
}
.site-nav a.quiet:hover{color:var(--ink-strong)}

.eyebrow{
  font-size:12px;font-weight:500;letter-spacing:.5px;line-height:16px;
  text-transform:uppercase;color:var(--ink-mid);
}

.btn{
  display:inline-block;padding:14px 28px;border-radius:var(--r-pill);
  background:var(--primary);color:var(--on-primary);
  font-weight:700;font-size:16px;letter-spacing:.1px;text-decoration:none;
  box-shadow:var(--shadow-raised);
  transition:transform .15s ease,box-shadow .15s ease;
}
.btn:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}

.site-footer{border-top:1px solid var(--outline);margin-top:96px;padding:40px 0 56px}
.site-footer .container{
  display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between;
}
.site-footer nav{display:flex;flex-wrap:wrap;gap:8px 24px}
.site-footer a{
  font-size:14px;color:var(--ink-mid);text-decoration:none;
}
.site-footer a:hover{color:var(--ink-strong)}
.site-footer .fine{font-size:12px;letter-spacing:.5px;color:var(--ink-muted)}

:focus-visible{outline:2px solid var(--primary-ink);outline-offset:3px;border-radius:2px}
`;

/**
 * Document styling for the prose pages (support, privacy, terms): a single
 * reading column on the app's type scale — `headlineLarge` for the page title,
 * `titleLarge` for sections, `bodyLarge` for the text itself.
 */
export const PROSE_CSS = `
.prose{max-width:680px;margin:0 auto;padding:24px 24px 0}
.prose h1{
  font-weight:700;font-size:28px;line-height:36px;color:var(--ink-strong);
  margin-bottom:8px;
}
.prose .updated{font-size:12px;letter-spacing:.5px;color:var(--ink-muted);margin-bottom:32px}
.prose .lede{font-size:18px;line-height:1.55;color:var(--ink-soft);margin-bottom:32px}
.prose h2{
  font-weight:600;font-size:18px;line-height:26px;letter-spacing:.1px;
  color:var(--ink-strong);margin:36px 0 10px;
}
.prose p{margin-bottom:14px}
.prose ul{margin:0 0 14px;padding-left:22px}
.prose li{margin-bottom:8px}
.prose li::marker{color:var(--ink-muted)}
.prose a{color:var(--primary-ink);text-decoration-color:var(--primary)}
.prose strong{font-weight:600;color:var(--ink-strong)}
.prose .card{
  background:var(--surface);border:1px solid var(--outline);
  border-radius:var(--r-xl);padding:24px;margin:24px 0;
  box-shadow:var(--shadow-rest);
}
.prose details{
  background:var(--surface);border:1px solid var(--outline);
  border-radius:var(--r-lg);padding:16px 20px;margin-bottom:12px;
  box-shadow:var(--shadow-rest);
}
.prose summary{
  font-weight:600;font-size:16px;letter-spacing:.15px;color:var(--ink-strong);
  cursor:pointer;list-style:none;position:relative;padding-right:28px;
}
.prose summary::-webkit-details-marker{display:none}
.prose summary::after{
  content:"";position:absolute;right:4px;top:50%;width:8px;height:8px;
  border-right:2px solid var(--ink-muted);border-bottom:2px solid var(--ink-muted);
  transform:translateY(-70%) rotate(45deg);transition:transform .2s;
}
.prose details[open] summary::after{transform:translateY(-30%) rotate(225deg)}
.prose details p{margin:12px 0 4px;font-size:14px;line-height:20px;letter-spacing:.25px}
`;

export interface PageOptions {
    /** Document title, used verbatim. */
    title: string;
    /** Meta + Open Graph description. */
    description: string;
    /** Absolute origin for Open Graph URLs; omit to skip og:image/og:url. */
    origin?: string;
    /** Path of this page, e.g. `/support`. */
    path: string;
    /** Page-specific CSS appended after the base styles. */
    styles?: string;
    /** Extra elements for `<head>` (preloads, scripts). */
    head?: string;
    /** Rendered inside `<body>` between nav and footer. */
    body: string;
    /** Landing page opts out: its hero carries the wordmark itself. */
    hideNav?: boolean;
}

export function renderPage(options: PageOptions): string {
    const { title, description, origin, path, styles, head, body, hideNav } =
        options;

    const og = origin
        ? `
<meta property="og:url" content="${origin}${path}">
<meta property="og:image" content="${origin}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${origin}/assets/og.png">`
        : `
<meta name="twitter:card" content="summary">`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">${og}
<meta name="theme-color" content="#FDFBF9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141110" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${FAVICON}">
<link rel="preload" href="/assets/fonts/poppins-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/poppins-400.woff2" as="font" type="font/woff2" crossorigin>
${head ?? ""}
<style>
${FONTS_CSS}
${TOKENS_CSS}
${BASE_CSS}
${styles ?? ""}
</style>
</head>
<body>
${
    hideNav
        ? ""
        : `<header class="site-nav"><div class="container">
  <a class="wordmark" href="/">FRIDGEEZY</a>
  <a class="quiet" href="/support">Support</a>
</div></header>`
}
${body}
<footer class="site-footer"><div class="container">
  <a class="wordmark" href="/">FRIDGEEZY</a>
  <nav>
    <a href="/support">Support</a>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Use</a>
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </nav>
  <span class="fine">© ${new Date().getFullYear()} ${SITE_NAME}</span>
</div></footer>
</body>
</html>`;
}
