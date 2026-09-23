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
 * **The site is LIGHT ONLY, and that is a decision rather than an omission**
 * (2026-09-23). It carried a `prefers-color-scheme: dark` block and shipped two
 * screenshots of every screen so the phone in the page matched the page around
 * it. What that cost is that every screenshot had to be captured twice, in two
 * themes, and a set that fell out of step showed a dark phone on a cream page —
 * which is exactly what a marketing page cannot afford. The app still has both
 * themes; the site advertises one. If dark ever comes back it comes back with a
 * second capture pass, not with a `<picture>` element and one theme's shots.
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
 * The App Store listing, once there is one. `null` is the honest current state
 * and every download control reads it: a null turns the badge into a
 * non-interactive "coming soon" plate rather than a link to a 404, and the
 * closing band says so in words.
 *
 * The App Store Connect app id is already provisioned (`ascAppId` in the app
 * repo's `eas.json`), so going live is this one line:
 *
 *   export const APP_STORE_URL = "https://apps.apple.com/app/id6747654257";
 */
export const APP_STORE_URL: string | null = null;

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
 * `COLORS.LIGHT` + `COLORS.COMMON`. Shadows are the `SHADOWS` recipes as CSS
 * box-shadows (shadow colour `COMMON.black`); radii are the `RADIUS` scale.
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
  --gutter:20px;
}
@media (min-width: 720px){:root{--gutter:32px}}
`;

/**
 * Base styles shared by every page: reset, the type scale (the `FONTS` variants
 * the site uses, at their exact metrics), and the shared nav/footer chrome.
 *
 * Written mobile-first — the bare declarations are the phone, and every
 * `@media` is `min-width`. The page this replaced was the other way round, with
 * six `max-width` breakpoints unpicking a desktop layout; a phone then had to
 * parse and then override every desktop rule to arrive at the layout most of
 * its readers get.
 */
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
/* Decorative elements (the hero's backdrop washes) deliberately exceed the
   viewport; clip instead of letting phones pan sideways. On BODY rather than on
   the root: the root is the viewport's own scroller, and giving it an explicit
   overflow changes what scrolls rather than only what is painted. Moving it
   there was tried on 2026-09-23 and reverted. */
body{
  font-family:'Poppins',-apple-system,system-ui,sans-serif;
  font-size:16px;line-height:1.5;letter-spacing:.15px;
  background:var(--bg);color:var(--ink);
  overflow-x:clip;
}
img{display:block;max-width:100%}
a{color:inherit}
.container{max-width:1120px;margin:0 auto;padding:0 var(--gutter)}

.wordmark{
  font-weight:600;font-size:13px;letter-spacing:.22em;
  color:var(--ink-strong);text-decoration:none;
}

/* The nav is sticky on every page, because the download control lives in it —
   a CTA that scrolls away is one the reader has to go back up for. Translucent
   rather than opaque so the washes behind it stay visible as they pass. */
.site-nav{
  position:sticky;top:0;z-index:40;
  padding:14px 0;
  background:rgba(253,251,249,.78);
  backdrop-filter:saturate(180%) blur(14px);
  -webkit-backdrop-filter:saturate(180%) blur(14px);
  border-bottom:1px solid transparent;
  transition:border-color .25s ease,background .25s ease;
}
.site-nav.stuck{border-bottom-color:var(--outline);background:rgba(253,251,249,.92)}
.site-nav .container{display:flex;align-items:center;justify-content:space-between;gap:12px}
.site-nav .links{display:flex;align-items:center;gap:20px}
.site-nav a.quiet{
  font-weight:500;font-size:14px;letter-spacing:.1px;
  color:var(--ink-mid);text-decoration:none;
}
.site-nav a.quiet:hover{color:var(--ink-strong)}
/* Below 560px the quiet link would sit tight against the CTA it competes with;
   the footer carries the same link one screen down. */
@media (max-width: 559px){.site-nav a.quiet{display:none}}

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

/* The compact download control in the nav — on every page, because this is
   the one thing the site is for and the landing hero's copy of it scrolls
   away. */
.nav-cta{
  display:inline-flex;align-items:center;gap:7px;white-space:nowrap;
  padding:9px 16px;border-radius:var(--r-pill);
  font-weight:600;font-size:13px;letter-spacing:.1px;text-decoration:none;
  background:var(--primary);color:var(--on-primary);
  box-shadow:var(--shadow-raised);
  transition:transform .15s ease,box-shadow .15s ease;
}
.nav-cta:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}
.nav-cta svg{width:14px;height:14px;fill:currentColor;flex:none}

.site-footer{border-top:1px solid var(--outline);margin-top:72px;padding:36px 0 48px}
.site-footer .container{
  display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between;
}
.site-footer nav{display:flex;flex-wrap:wrap;gap:8px 24px}
.site-footer a{
  font-size:14px;color:var(--ink-mid);text-decoration:none;
}
.site-footer a:hover{color:var(--ink-strong)}
.site-footer .fine{font-size:12px;letter-spacing:.5px;color:var(--ink-muted)}
@media (min-width: 720px){.site-footer{margin-top:96px;padding:40px 0 56px}}

:focus-visible{outline:2px solid var(--primary-ink);outline-offset:3px;border-radius:2px}
`;

/**
 * Document styling for the prose pages (support, privacy, terms): a single
 * reading column on the app's type scale — `headlineLarge` for the page title,
 * `titleLarge` for sections, `bodyLarge` for the text itself.
 */
export const PROSE_CSS = `
.prose{max-width:680px;margin:0 auto;padding:24px var(--gutter) 0}
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

/** Apple's mark, for the download controls. 24×24, drawn as a fill. */
export const APPLE_GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.95 3.6 2.89 1.44-.06 1.99-.93 3.73-.93s2.23.93 3.76.9c1.56-.03 2.54-1.41 3.49-2.81 1.1-1.61 1.55-3.17 1.58-3.25-.04-.02-3.02-1.16-3.04-4.6zM14.16 4.06c.79-.96 1.33-2.29 1.18-3.62-1.14.05-2.52.76-3.34 1.72-.73.85-1.38 2.21-1.2 3.51 1.27.1 2.57-.65 3.36-1.61z"/></svg>`;

/**
 * Where every download control on the site points, resolved once. Until there
 * is a listing the answer is an email rather than a dead pill: the page's one
 * action has to go somewhere, and a control that looks pressable and is not is
 * the thing the app's own disabled-state rule exists to prevent.
 */
export const DOWNLOAD_HREF =
    APP_STORE_URL ??
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        `${SITE_NAME} — early invite`
    )}`;

/** The nav's compact download control. */
function renderNavCta(): string {
    return `<a class="nav-cta" href="${DOWNLOAD_HREF}">${APPLE_GLYPH}${
        APP_STORE_URL ? "Get the app" : "Early invite"
    }</a>`;
}

/**
 * Sets `.stuck` on the nav once the page has moved, so the hairline and the
 * heavier ground only appear when there is something scrolling underneath it.
 * `{passive:true}` because this listener must never be able to block a scroll.
 */
const NAV_SCRIPT = `
(function(){
  var nav=document.querySelector('.site-nav');
  if(!nav)return;
  var on=function(){nav.classList.toggle('stuck',window.scrollY>8)};
  addEventListener('scroll',on,{passive:true});on();
})();
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
    /** Page-specific script, run after the shared nav script. */
    script?: string;
}

export function renderPage(options: PageOptions): string {
    const { title, description, origin, path, styles, head, body, script } =
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">${og}
<meta name="theme-color" content="#FDFBF9">
<meta name="color-scheme" content="light">
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
<header class="site-nav"><div class="container">
  <a class="wordmark" href="/">FRIDGEEZY</a>
  <span class="links">
    <a class="quiet" href="/support">Support</a>
    ${renderNavCta()}
  </span>
</div></header>
${body}
<footer class="site-footer"><div class="container">
  <a class="wordmark" href="/">FRIDGEEZY</a>
  <nav>
    <a href="/support">Support</a>
    <a href="/feature-request">Feature requests</a>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Use</a>
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
  </nav>
  <span class="fine">© ${new Date().getFullYear()} ${SITE_NAME}</span>
</div></footer>
<script>${NAV_SCRIPT}${script ?? ""}</script>
</body>
</html>`;
}
