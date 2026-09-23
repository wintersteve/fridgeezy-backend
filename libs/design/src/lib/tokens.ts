/**
 * The design tokens, in ONE place.
 *
 * These values originate in the client app's design system
 * (`fridgeezy/src/shared/theme/constants`) and that is still where they are
 * decided — the phone is the product and the web surfaces dress to match it.
 * What has changed is how many copies exist on this side of the wire.
 *
 * Until 2026-09-23 there were three, and each knew it: the site's `chrome.ts`
 * carried them as CSS custom properties, the console's `styles.css` copied
 * those, and the console's `theme.ts` copied THOSE into a TypeScript object.
 * That last file's own header said so in as many words — "change a colour here
 * and change it there" — and judged a shared module "the heavier mistake" for
 * two consumers. With the site on MUI as well the arithmetic inverts: the same
 * peach now has to be right in a CSS custom property, a MUI palette and an
 * emotion `sx` object, and three hand-synchronised copies of a hex value is a
 * drift waiting for the one surface nobody re-checked.
 *
 * So: this module is the source, `theme.ts` beside it derives the MUI theme
 * from it, and `CSS_VARIABLES` supplies the custom properties for the CSS that
 * is still hand-written. Nothing downstream re-picks a colour.
 */

export const TOKENS = {
    bg: "#FCFAF6",
    bgVariant: "#F8F5F0",
    surface: "#FFFFFF",
    ink: "#5C5450",
    inkStrong: "#3A332F",
    inkMuted: "#9A938F",
    inkSoft: "#8A8380",
    inkMid: "#7A736F",
    outline: "rgba(232, 228, 224, .6)",
    outlineSolid: "#E8E4E0",
    primary: "#F4A67A",
    onPrimary: "#FFFFFF",
    primaryContainer: "#FFF5EE",
    primaryInk: "#A35529",
    secondary: "#93C5A8",
    secondaryContainer: "#F0F7F2",
    secondaryInk: "#3F7A58",
    onSecondaryContainer: "#1D192B",
    roseContainer: "#FFF3F0",
    roseInk: "#6E3733",
    tertiaryInk: "#3C6B81",
    tertiaryContainer: "#EEF4F8",
    errorInk: "#A3322B",
    errorContainer: "#FDF0EE",
    /**
     * The difficulty ramp, and the app's `COMMON` values verbatim.
     *
     * Theme-independent there and here: the chip's label is set in the FILL
     * itself against the `*Bg` tint, so a ground that followed the theme would
     * drift out of contrast. The `Bg` values are each fill cut to an ~18% tint
     * against white.
     *
     * The client uses the three fills for a second job the site now copies —
     * ranking the macros on a nutrition card, cheapest to dearest — so these
     * are not only "the difficulty colours" and should not be renamed to that.
     */
    difficultyEasy: "#A8D5BA",
    difficultyMedium: "#F4C78A",
    difficultyHard: "#E8A0A0",
    difficultyEasyBg: "#EEF7F1",
    difficultyMediumBg: "#FDF4E8",
    difficultyHardBg: "#FAECEC",
    /** The hairline between columns in a card. `gray300` in the client. */
    rule: "#E8E4E0",
    shadowRest: "0 4px 4px rgba(6, 6, 6, .0125)",
    shadowRaised: "0 2px 8px rgba(6, 6, 6, .06)",
    shadowFloating: "0 6px 16px rgba(6, 6, 6, .06)",
    sans: "'Poppins', -apple-system, system-ui, sans-serif",
    serif: "'Lora', Georgia, 'Times New Roman', serif",
    radius: { sm: 6, md: 8, lg: 12, xl: 16, xxl: 28, pill: 999 },
    sidebar: 224,
} as const;

/**
 * The quiet-heading idiom, in one place.
 *
 * Small, tracked, uppercase, muted — what every section label in the client
 * looks like, and what stops a card full of fields reading as a form. It is
 * shared by `h2`, a table header, the console's sidebar group labels and the
 * site's section eyebrows, so it is a value rather than four near-identical
 * rules.
 */
export const QUIET_HEADING = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    color: TOKENS.inkMuted,
};

/**
 * The tokens as CSS custom properties, for the stylesheets that are still
 * hand-written — the console's shell and the site's bespoke page CSS (phone
 * frames, snap rails, the hero's washes). Those are static, comment-heavy and
 * gain nothing from being JavaScript object literals, but they must not hold a
 * SECOND copy of a colour, which is what this closes.
 *
 * It is a RECORD first and a string second, because the two consumers need
 * different shapes and only one of them is obvious. The site prints a
 * stylesheet, so it wants text. The console injects them through MUI's
 * `GlobalStyles`, which serialises with emotion — and emotion takes a
 * declaration OBJECT: handed `{ ":root": "--primary-ink:#A35529;…" }` it emits
 * nothing at all, silently, and every `var(--…)` in the console's stylesheet
 * resolves to empty. Measured 2026-09-23, after exactly that.
 */
export const CSS_VARIABLES: Record<string, string> = {
    "--bg": TOKENS.bg,
    "--bg-variant": TOKENS.bgVariant,
    "--surface": TOKENS.surface,
    "--ink": TOKENS.ink,
    "--ink-strong": TOKENS.inkStrong,
    "--ink-muted": TOKENS.inkMuted,
    "--ink-soft": TOKENS.inkSoft,
    "--ink-mid": TOKENS.inkMid,
    "--outline": TOKENS.outline,
    "--outline-solid": TOKENS.outlineSolid,
    "--primary": TOKENS.primary,
    "--on-primary": TOKENS.onPrimary,
    "--primary-container": TOKENS.primaryContainer,
    "--primary-ink": TOKENS.primaryInk,
    "--secondary": TOKENS.secondary,
    "--secondary-container": TOKENS.secondaryContainer,
    "--secondary-ink": TOKENS.secondaryInk,
    "--on-secondary-container": TOKENS.onSecondaryContainer,
    "--rose-container": TOKENS.roseContainer,
    "--rose-ink": TOKENS.roseInk,
    "--tertiary-ink": TOKENS.tertiaryInk,
    "--tertiary-container": TOKENS.tertiaryContainer,
    "--error-ink": TOKENS.errorInk,
    "--error-container": TOKENS.errorContainer,
    "--rule": TOKENS.rule,
    "--serif": TOKENS.serif,
    "--shadow-rest": TOKENS.shadowRest,
    "--shadow-raised": TOKENS.shadowRaised,
    "--shadow-floating": TOKENS.shadowFloating,
    "--r-sm": `${TOKENS.radius.sm}px`,
    "--r-md": `${TOKENS.radius.md}px`,
    "--r-lg": `${TOKENS.radius.lg}px`,
    "--r-xl": `${TOKENS.radius.xl}px`,
    "--r-xxl": `${TOKENS.radius.xxl}px`,
    "--r-pill": `${TOKENS.radius.pill}px`,
    "--sidebar": `${TOKENS.sidebar}px`,
};

/** The same declarations as a CSS string, for a caller printing a stylesheet. */
export function cssVariables(): string {
    return Object.entries(CSS_VARIABLES)
        .map(([name, value]) => `${name}:${value}`)
        .join(";");
}
