import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { TOKENS } from "./tokens";

/**
 * The pieces BOTH web surfaces draw, on MUI.
 *
 * This file is deliberately short, and the shortness is the finding rather than
 * an omission. A marketing page and a data console share a palette, a type
 * scale and a set of controls — which is the theme, and the theme is where
 * nearly all of the sharing actually happens: the site writes
 * `<Typography variant="h2">` and gets the same tracked quiet heading the
 * console's table headers wear, without either surface holding a copy of it.
 *
 * What they do NOT share is furniture. The console's `ui.tsx` is a data table,
 * a pager, a sort label, a confirm dialog and a filter bar; a landing page
 * mounts none of those, and a phone frame with a snap rail of screenshots is
 * of no use to a table of recipes. Hoisting either set into here to make the
 * library look fuller would create components with one caller and a second
 * place to look for them.
 *
 * So the bar for adding something here is TWO REAL CALLERS, one on each
 * surface. `Wordmark` failed it and stayed put: the console sets "Fridgeezy"
 * in two weights down a sidebar, the site tracks it out in small caps across a
 * nav, and sharing it would have meant picking one and making the other wrong.
 */

/** The tones a state can be reported in, and what each one is FOR. */
const PILL_TONE = {
    neutral: { background: TOKENS.bgVariant, color: TOKENS.inkMid },
    hidden: { background: TOKENS.errorContainer, color: TOKENS.errorInk },
    live: { background: TOKENS.secondaryContainer, color: TOKENS.secondaryInk },
    accent: { background: TOKENS.primaryContainer, color: TOKENS.primaryInk },
    info: { background: TOKENS.tertiaryContainer, color: TOKENS.tertiaryInk },
    rose: { background: TOKENS.roseContainer, color: TOKENS.roseInk },
} as const;

export type PillTone = keyof typeof PILL_TONE;

/**
 * A state, as a small filled lozenge.
 *
 * It exists so a surface never reaches for a raw MUI prop twice: if every
 * table and every card wrote `<Chip size="small" sx={{ background: … }}>`
 * instead, the fifth one would differ from the first.
 */
export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
    return <Chip size="small" label={children} sx={PILL_TONE[tone]} />;
}

/**
 * A quiet line — a caption, a value that is absent, a sentence under a
 * heading. It is `inkMuted` in one place rather than an `sx` on thirty cells,
 * and it renders as a `<span>` so it can sit inside a sentence as well as
 * under one.
 */
export function Muted({ children }: { children: ReactNode }) {
    return (
        <Typography component="span" variant="caption" sx={{ color: TOKENS.inkMuted }}>
            {children}
        </Typography>
    );
}
