import { TOKENS } from "@fridgeezy/design";
import Container from "@mui/material/Container";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * The reading column the four document pages share: support, privacy, terms
 * and the feature-request page.
 *
 * ## Their BODIES are still HTML strings, deliberately
 *
 * Everything else on this site became JSX when it moved to MUI. These did not,
 * and it is a decision rather than work left undone: a privacy policy and a
 * terms of use are legal text, the value is in the words being exactly right,
 * and hand-converting several hundred lines of `<p>` and `<li>` into JSX is a
 * mechanical edit across the one part of the site where a silent typo is
 * expensive. Nothing is gained by it either — there are no props, no state and
 * no components in a policy, just markup.
 *
 * So the pages keep their authored markup and hand it to `<Prose>`, which
 * mounts it inside a MUI `Container` carrying the `sx` below. The styling is
 * shared and themed; the words are untouched.
 *
 * `dangerouslySetInnerHTML` is safe here in the way the name is asking about:
 * every byte is authored in this repository and rendered at BUILD time. No
 * value from a request, a database or a reader reaches it. If that ever stops
 * being true — a page templating in something fetched — this has to become
 * JSX, and that is the line to hold.
 */

/**
 * The document styling, as one `sx` reaching into the markup below it.
 *
 * Descendant selectors rather than styled components for the same reason the
 * bodies are strings: the elements are written as plain HTML, so the styling
 * has to meet them where they are. The type scale is the app's — `headlineLarge`
 * for the title, `titleLarge` for sections, `bodyLarge` for the text.
 */
export const PROSE_SX: SxProps<Theme> = {
    maxWidth: 680,
    mx: "auto",
    px: { xs: 5, md: 8 },
    pt: 6,
    color: TOKENS.ink,
    fontSize: 16,
    lineHeight: 1.5,
    letterSpacing: ".15px",

    "& h1": {
        fontWeight: 700,
        fontSize: 28,
        lineHeight: "36px",
        color: TOKENS.inkStrong,
        mb: 2,
    },
    "& .updated": {
        fontSize: 12,
        letterSpacing: ".5px",
        color: TOKENS.inkMuted,
        mb: 8,
    },
    "& .lede": {
        fontSize: 18,
        lineHeight: 1.55,
        color: TOKENS.inkSoft,
        mb: 8,
    },
    "& h2": {
        fontWeight: 600,
        fontSize: 18,
        lineHeight: "26px",
        letterSpacing: ".1px",
        color: TOKENS.inkStrong,
        mt: 9,
        mb: 2.5,
    },
    "& p": { mb: 3.5 },
    "& ul": { m: 0, mb: 3.5, pl: 5.5 },
    "& li": { mb: 2 },
    "& li::marker": { color: TOKENS.inkMuted },
    "& a": { color: TOKENS.primaryInk, textDecorationColor: TOKENS.primary },
    "& strong": { fontWeight: 600, color: TOKENS.inkStrong },

    "& .card": {
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.outline}`,
        borderRadius: `${TOKENS.radius.xl}px`,
        p: 6,
        my: 6,
        boxShadow: TOKENS.shadowRest,
    },

    // `<details>` rather than a MUI Accordion: the page stays script-free, and
    // the native element already does the one thing an accordion does.
    "& details": {
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.outline}`,
        borderRadius: `${TOKENS.radius.lg}px`,
        p: "16px 20px",
        mb: 3,
        boxShadow: TOKENS.shadowRest,
    },
    "& summary": {
        fontWeight: 600,
        fontSize: 16,
        letterSpacing: ".15px",
        color: TOKENS.inkStrong,
        cursor: "pointer",
        listStyle: "none",
        position: "relative",
        pr: 7,
        "&::-webkit-details-marker": { display: "none" },
        "&::after": {
            content: '""',
            position: "absolute",
            right: 4,
            top: "50%",
            width: 8,
            height: 8,
            borderRight: `2px solid ${TOKENS.inkMuted}`,
            borderBottom: `2px solid ${TOKENS.inkMuted}`,
            transform: "translateY(-70%) rotate(45deg)",
            transition: "transform .2s",
        },
    },
    "& details[open] summary::after": { transform: "translateY(-30%) rotate(225deg)" },
    "& details p": { mt: 3, mb: 1, fontSize: 14, lineHeight: "20px", letterSpacing: ".25px" },
};

export function Prose({ html }: { html: string }) {
    return (
        <Container
            component="main"
            disableGutters
            sx={PROSE_SX}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
