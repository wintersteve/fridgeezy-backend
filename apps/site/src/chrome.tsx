import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { cssVariables, fontFaceCss, fontPreloadTags, theme, TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { ThemeProvider } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Shared page chrome for the public site: the document, the nav and the footer.
 *
 * ## The site is React + MUI, and it still ships NO RUNTIME JAVASCRIPT
 *
 * That is the whole shape of the 2026-09-23 move, and it is worth being exact
 * about because "we use MUI now" usually means a bundle. Every page here is
 * rendered ONCE, at build time, by `renderToStaticMarkup`, and emotion's
 * insertion cache is drained into a `<style>` block in the head. What lands in
 * S3 is the same thing as before — a self-contained HTML file with its CSS
 * inline and about thirty lines of hand-written vanilla script — so the site
 * keeps working with JavaScript off, keeps its SEO, and keeps loading in one
 * request. React and MUI are build-time dependencies, like a CSS preprocessor.
 *
 * Do not add `hydrateRoot`, a `<script type="module">` or a Vite SPA build to
 * "make a component interactive". The three interactive things on this site —
 * the nav's scrolled state, the scroll entrances and the cycling headline word
 * — are a few lines of DOM each, and a React runtime to serve them would cost
 * two orders of magnitude more than they are worth. If something genuinely
 * needs a component's state, it is probably a page that belongs in the console.
 *
 * ## Why MUI at all, then
 *
 * The console went to MUI first, and the two surfaces were maintaining the same
 * palette in three hand-synchronised copies — the note at the top of
 * `@fridgeezy/design`'s `tokens.ts` has the history. Sharing the THEME is the
 * substantive win: a `<Button variant="contained">` here and one in the console
 * are now the same object, and a palette change is one file. The components
 * this page actually mounts are few and ordinary (Button, Container, Stack,
 * Typography, Link, Paper) because that is genuinely all a marketing page has
 * in common with a data console.
 *
 * ## The bespoke CSS stayed CSS
 *
 * The phone frames, the scroll-snap rails, the hero's radial washes, the
 * keyframes and the reveal transitions are handed to `renderPage` as a string
 * and emitted after the emotion block. They are static, they are the most
 * heavily commented thing in this app, and rewriting them as `sx` object
 * literals would buy nothing and cost every one of those comments its context.
 * `sx` is for what varies; a stylesheet is for what does not. Both read the
 * same tokens through `cssVariables()`, so there is still only one peach.
 */

export const SITE_NAME = "Fridgeezy";
export const SUPPORT_EMAIL = "support@wintersteve.com";

/**
 * The App Store listing, once there is one. `null` is the honest current state
 * and every download control reads it.
 *
 * The App Store Connect app id is already provisioned (`ascAppId` in the app
 * repo's `eas.json`), so going live is this one line:
 *
 *   export const APP_STORE_URL = "https://apps.apple.com/app/id6747654257";
 */
export const APP_STORE_URL: string | null = null;

/**
 * Where every download control on the site points, resolved once. Until there
 * is a listing the answer is an email rather than a dead pill: the page's one
 * action has to go somewhere, and a control that looks pressable and is not is
 * the thing the app's own disabled-state rule exists to prevent.
 */
export const DOWNLOAD_HREF =
    APP_STORE_URL ??
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${SITE_NAME} — early invite`)}`;

/** Apple's mark, for the download controls. */
export const AppleGlyph = ({ size = 20 }: { size?: number }) => (
    <Box
        component="svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        sx={{ width: size, height: size, fill: "currentColor", flex: "none" }}
    >
        <path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.95 3.6 2.89 1.44-.06 1.99-.93 3.73-.93s2.23.93 3.76.9c1.56-.03 2.54-1.41 3.49-2.81 1.1-1.61 1.55-3.17 1.58-3.25-.04-.02-3.02-1.16-3.04-4.6zM14.16 4.06c.79-.96 1.33-2.29 1.18-3.62-1.14.05-2.52.76-3.34 1.72-.73.85-1.38 2.21-1.2 3.51 1.27.1 2.57-.65 3.36-1.61z" />
    </Box>
);

/**
 * A small favicon drawn inline: the app icon's overhead bowl, reduced to a
 * peach squircle holding a white arc. Inline data URI so the site ships no
 * binary icon asset and every page carries it in one place.
 */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${TOKENS.primary}"/><circle cx="32" cy="30" r="15" fill="none" stroke="#FFFFFF" stroke-width="5"/><path d="M14 36h36a18 18 0 0 1-36 0z" fill="#FFFFFF"/></svg>`
)}`;

/**
 * Every reading column on the site, on the gutter above. `disableGutters` plus
 * this, rather than MUI's own padding: Container's default gutter is a spacing
 * multiple, and with this theme's 4px base it resolves to 8px, which is half
 * what this site has ever used.
 */
export const CONTAINER_SX = { px: "var(--gutter)" } as const;

/** The wordmark, in the site's own treatment: tracked small caps. */
export const Wordmark = ({ sx }: { sx?: object }) => (
    <Link
        href="/"
        underline="none"
        sx={{
            fontWeight: 600,
            fontSize: 13,
            letterSpacing: ".22em",
            color: TOKENS.inkStrong,
            ...sx,
        }}
    >
        FRIDGEEZY
    </Link>
);

/**
 * The nav's compact download control — on every page, because this is the one
 * thing the site is for and the landing hero's copy of it scrolls away.
 */
const NavCta = () => (
    <Button
        variant="contained"
        href={DOWNLOAD_HREF}
        startIcon={<AppleGlyph size={14} />}
        sx={{ whiteSpace: "nowrap", fontSize: 13, px: 4, py: 2.25 }}
    >
        {APP_STORE_URL ? "Get the app" : "Early invite"}
    </Button>
);

/**
 * Sticky on every page, because the download control lives in it — a CTA that
 * scrolls away is one the reader has to go back up for. Translucent rather
 * than opaque so the hero's washes stay visible as they pass under it.
 *
 * This is the ONLY pinned element on the site. A download dock pinned to the
 * foot shipped for a few hours and was removed: on a phone it stacked against
 * this and ate a band top and bottom of a screen that is mostly a picture of a
 * phone, to re-offer a control two centimetres above it.
 */
const SiteNav = () => (
    <Box
        component="header"
        className="site-nav"
        sx={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            py: 3.5,
            background: "rgba(252,250,246,.78)",
            backdropFilter: "saturate(180%) blur(14px)",
            borderBottom: "1px solid transparent",
            transition: "border-color .25s ease, background .25s ease",
            "&.stuck": {
                borderBottomColor: TOKENS.outline,
                background: "rgba(252,250,246,.92)",
            },
        }}
    >
        <Container maxWidth="lg" disableGutters sx={CONTAINER_SX}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={3}>
                <Wordmark />
                <Stack direction="row" alignItems="center" gap={5}>
                    <Link
                        href="/support"
                        underline="none"
                        sx={{
                            fontWeight: 500,
                            fontSize: 14,
                            color: TOKENS.inkMid,
                            "&:hover": { color: TOKENS.inkStrong },
                            // Below 560 this would sit tight against the CTA it
                            // competes with; the footer carries it one screen down.
                            display: { xs: "none", sm: "block" },
                        }}
                    >
                        Support
                    </Link>
                    <NavCta />
                </Stack>
            </Stack>
        </Container>
    </Box>
);

const FOOTER_LINKS = [
    { href: "/support", label: "Support" },
    { href: "/feature-request", label: "Feature requests" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms of Use" },
    { href: `mailto:${SUPPORT_EMAIL}`, label: SUPPORT_EMAIL },
];

const SiteFooter = () => (
    <Box
        component="footer"
        sx={{
            borderTop: `1px solid ${TOKENS.outline}`,
            mt: { xs: 18, md: 24 },
            pt: { xs: 9, md: 10 },
            pb: { xs: 12, md: 14 },
        }}
    >
        <Container maxWidth="lg" disableGutters sx={CONTAINER_SX}>
            <Stack
                direction="row"
                flexWrap="wrap"
                alignItems="center"
                justifyContent="space-between"
                gap={{ xs: 4, sm: 8 }}
            >
                <Wordmark />
                <Stack direction="row" component="nav" flexWrap="wrap" gap={{ xs: 2, sm: 6 }}>
                    {FOOTER_LINKS.map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            underline="none"
                            sx={{
                                fontSize: 14,
                                fontWeight: 400,
                                color: TOKENS.inkMid,
                                "&:hover": { color: TOKENS.inkStrong },
                            }}
                        >
                            {label}
                        </Link>
                    ))}
                </Stack>
                <Typography variant="caption" sx={{ letterSpacing: ".5px", color: TOKENS.inkMuted }}>
                    © {new Date().getFullYear()} {SITE_NAME}
                </Typography>
            </Stack>
        </Container>
    </Box>
);

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

/**
 * Base rules that are not worth a component: the reset MUI's `CssBaseline`
 * does not cover, and the horizontal clip.
 */
const BASE_CSS = `
/* The page gutter. A LAYOUT value rather than a design token, so it lives here
   rather than in @fridgeezy/design — the console has a sidebar and no gutter at
   all. It is a custom property because the rails read it twice: once to cancel
   it and bleed to the screen edges, once to restore it as scroll padding so the
   first card still lines up with the heading above it. CONTAINER_SX hands the
   same value to MUI, so there is one number and not two. */
:root{--gutter:20px}
@media (min-width: 720px){:root{--gutter:32px}}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
/* "height:auto" is not decoration. Every <img> here carries width/height
   attributes so the browser can reserve the box before the bytes arrive, and
   those map to PRESENTATIONAL width/height — so a rule setting only the width
   leaves the attribute's height in force and the picture renders stretched.
   The recipe hero did exactly that: 415 wide by 1200 tall. Anything that wants
   a fixed height says so with more specificity (.phone img), which still
   wins. */
img{display:block;max-width:100%;height:auto}
:focus-visible{outline:2px solid var(--primary-ink);outline-offset:3px;border-radius:2px}
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
    /** Page-specific CSS, emitted after the emotion block so it can override. */
    styles?: string;
    /** Extra elements for `<head>` (preloads). */
    head?: string;
    /** Page-specific script, run after the shared nav script. */
    script?: string;
    /** The page itself, between nav and footer. */
    children: ReactNode;
}

export function renderPage(options: PageOptions): string {
    const { title, description, origin, path, styles, head, script, children } = options;

    // A fresh cache per page, or page two inherits page one's `inserted` map and
    // ships the landing page's rules on the privacy policy. `key` is the class
    // prefix; `compat` is what makes emotion record the serialised rules on the
    // cache at all, which is how they are recovered without @emotion/server.
    const cache = createCache({ key: "fz", prepend: true });
    cache.compat = true;

    const body = renderToStaticMarkup(
        <CacheProvider value={cache}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <SiteNav />
                {children}
                <SiteFooter />
            </ThemeProvider>
        </CacheProvider>
    );

    const emotionCss = Object.values(cache.inserted)
        .filter((value): value is string => typeof value === "string")
        .join("");

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
<meta name="theme-color" content="${TOKENS.bg}">
<meta name="color-scheme" content="light">
<link rel="icon" href="${FAVICON}">
${fontPreloadTags("/assets/fonts")}
${head ?? ""}
<style>
${fontFaceCss("/assets/fonts")}
:root{${cssVariables()}}
${BASE_CSS}
${emotionCss}
${styles ?? ""}
</style>
</head>
<body>
${body}
<script>${NAV_SCRIPT}${script ?? ""}</script>
</body>
</html>`;
}
