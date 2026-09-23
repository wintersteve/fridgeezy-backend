import { createTheme } from "@mui/material/styles";

import { QUIET_HEADING, TOKENS } from "./tokens";

/**
 * MUI, wearing the app's clothes.
 *
 * ## Why a theme this long
 *
 * Stock MUI is Roboto on white with a blue accent, 4px corners and a heavy
 * shadow on everything — a look nobody would mistake for this product. The
 * library was brought in for the CONTROLS (a real select, a real dialog, a
 * table that sorts, a snackbar) rather than for its appearance, so every value
 * below comes from `tokens.ts`, which is the one copy. It used to be declared
 * in this file and hand-synchronised with two stylesheets; see that file's
 * header for why that stopped being affordable once the site joined.
 *
 * ## It serves BOTH web surfaces
 *
 * The console and the marketing site render from this same theme, which is the
 * point of it living in a lib. Most of what follows is console furniture — a
 * table, a dialog, a sort label — and the site simply never mounts those
 * components, so they cost it nothing. What the site actually reads is the
 * palette, the type scale, the shadow ramp and the Button/Paper/Link overrides.
 * **Neither surface may fork this theme**: a second `createTheme` is how one
 * peach becomes two.
 *
 * ## Three things MUI does that had to be turned OFF
 *
 * - **Uppercase button labels.** `textTransform: "none"`, because the app
 *   writes "Email me a code", not "EMAIL ME A CODE".
 * - **Elevation shadows.** Material lifts a paper off the page with a shadow;
 *   this product separates a card from the ground with a hairline outline and
 *   the warm ground behind it, and its own `rest` shadow really is that faint.
 * - **The ripple.** A press here is acknowledged by a tint, which is what the
 *   app's own `tint` tier does for a row in a list; an expanding circle is a
 *   second vocabulary for the same event.
 */

export const theme = createTheme({
    // Material's own is 8; this console's spacing scale is the app's 4-point
    // grid, so `spacing(2)` reads as 8 and every gap below is in those units.
    spacing: 4,
    shape: { borderRadius: TOKENS.radius.lg },
    palette: {
        mode: "light",
        background: { default: TOKENS.bg, paper: TOKENS.surface },
        text: {
            primary: TOKENS.ink,
            secondary: TOKENS.inkSoft,
            disabled: TOKENS.inkMuted,
        },
        divider: TOKENS.outlineSolid,
        // `main` is the FILL and `dark` is the readable ink of the same hue —
        // the app's `primary` / `primaryInk` pair. MUI reaches for `main` when
        // it wants a surface and for `contrastText` on top of it; anything
        // being READ takes `dark`, because the accents here are washed and a
        // peach fill measures under 2:1 as small text.
        primary: {
            main: TOKENS.primary,
            light: TOKENS.primaryContainer,
            dark: TOKENS.primaryInk,
            contrastText: TOKENS.onPrimary,
        },
        secondary: {
            main: TOKENS.secondary,
            light: TOKENS.secondaryContainer,
            dark: TOKENS.secondaryInk,
            contrastText: TOKENS.onPrimary,
        },
        error: { main: TOKENS.errorInk, light: TOKENS.errorContainer, dark: TOKENS.errorInk },
        info: { main: TOKENS.tertiaryInk, light: TOKENS.tertiaryContainer, dark: TOKENS.tertiaryInk },
        success: { main: TOKENS.secondaryInk, light: TOKENS.secondaryContainer, dark: TOKENS.secondaryInk },
        warning: { main: TOKENS.primaryInk, light: TOKENS.primaryContainer, dark: TOKENS.primaryInk },
        action: { hover: TOKENS.primaryContainer, selected: TOKENS.primaryContainer },
    },
    typography: {
        fontFamily: TOKENS.sans,
        fontSize: 14,
        htmlFontSize: 16,
        h1: { fontSize: 26, fontWeight: 700, letterSpacing: "-.5px", color: TOKENS.inkStrong },
        h2: QUIET_HEADING,
        h3: { fontSize: 14, fontWeight: 600, color: TOKENS.inkStrong },
        body1: { fontSize: 14, lineHeight: 1.5 },
        body2: { fontSize: 13, lineHeight: 1.5 },
        caption: { fontSize: 12, color: TOKENS.inkSoft },
        button: { textTransform: "none", fontWeight: 600, fontSize: 13 },
    },
    // Material's 25-step elevation ramp replaced by the app's three. Index 1 is
    // what `Paper` takes by default, so a card gets `rest` without asking.
    shadows: [
        "none",
        TOKENS.shadowRest,
        TOKENS.shadowRaised,
        ...Array.from({ length: 22 }, () => TOKENS.shadowFloating),
    ] as never,
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: { background: TOKENS.bg, WebkitFontSmoothing: "antialiased" },
                // The app's own focus ring, on everything, rather than each
                // component's idea of one.
                ":focus-visible": {
                    outline: `2px solid ${TOKENS.primaryInk}`,
                    outlineOffset: 2,
                },
            },
        },
        MuiButtonBase: { defaultProps: { disableRipple: true } },
        MuiPaper: {
            defaultProps: { elevation: 1 },
            styleOverrides: {
                root: {
                    backgroundImage: "none",
                    border: `1px solid ${TOKENS.outline}`,
                    borderRadius: TOKENS.radius.xl,
                },
            },
        },
        MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: {
                root: { borderRadius: TOKENS.radius.pill, padding: "8px 16px", minHeight: 36 },
                // An outlined button is the console's workhorse — every row
                // action is one — so its resting edge is the neutral outline
                // rather than a tint of the accent.
                outlined: {
                    borderColor: TOKENS.outlineSolid,
                    color: TOKENS.inkStrong,
                    "&:hover": { borderColor: TOKENS.outlineSolid, background: TOKENS.bgVariant },
                },
                contained: { "&:hover": { boxShadow: TOKENS.shadowRaised } },
                text: { "&:hover": { background: TOKENS.bgVariant } },
                sizeSmall: { fontSize: 12, padding: "4px 12px", minHeight: 30 },
            },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    background: TOKENS.surface,
                    borderRadius: TOKENS.radius.md,
                    fontSize: 13,
                    "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.outlineSolid },
                    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.inkMuted },
                    // One peach hairline, not Material's two-pixel jump: the
                    // field must not change size as it takes focus.
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                        borderColor: TOKENS.primaryInk,
                        borderWidth: 1,
                    },
                },
                input: { padding: "9px 12px" },
            },
        },
        MuiInputLabel: {
            styleOverrides: { root: { fontSize: 13, color: TOKENS.inkSoft } },
        },
        MuiFormLabel: {
            styleOverrides: { root: { "&.Mui-focused": { color: TOKENS.primaryInk } } },
        },
        MuiFormHelperText: {
            styleOverrides: { root: { fontSize: 12, color: TOKENS.inkSoft, marginLeft: 2 } },
        },
        MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
        MuiSelect: { defaultProps: { size: "small" } },
        MuiMenuItem: { styleOverrides: { root: { fontSize: 13 } } },
        MuiTable: { styleOverrides: { root: { borderCollapse: "collapse" } } },
        MuiTableCell: {
            styleOverrides: {
                root: { borderBottom: `1px solid ${TOKENS.outline}`, padding: "12px" },
                head: { ...QUIET_HEADING, padding: "10px 12px", whiteSpace: "nowrap" },
                body: { fontSize: 13, color: TOKENS.ink },
            },
        },
        MuiTableRow: {
            styleOverrides: {
                root: {
                    // A peach wash is the app's hover and selection treatment
                    // everywhere; a neutral grey on a white card reads as a
                    // DISABLED row rather than a live one.
                    "&:hover": { background: TOKENS.primaryContainer },
                    "&:last-child td": { borderBottom: "none" },
                },
                head: { "&:hover": { background: "transparent" } },
            },
        },
        MuiTableSortLabel: {
            styleOverrides: {
                root: {
                    color: "inherit",
                    "&:hover": { color: TOKENS.inkStrong },
                    "&.Mui-active": {
                        color: TOKENS.primaryInk,
                        "& .MuiTableSortLabel-icon": { color: TOKENS.primaryInk },
                    },
                },
                // Visible at rest rather than on hover: a control that appears
                // under the pointer is one a reader has to already know is
                // there. Faint, so six headers do not read as six marks.
                icon: { opacity: 0.35, fontSize: 16 },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: { borderRadius: TOKENS.radius.pill, fontWeight: 600, fontSize: 11 },
                sizeSmall: { height: 22 },
                label: { paddingLeft: 10, paddingRight: 10 },
            },
        },
        MuiDialog: {
            styleOverrides: { paper: { borderRadius: TOKENS.radius.xl, padding: 8 } },
        },
        MuiDialogTitle: {
            styleOverrides: { root: { ...QUIET_HEADING, paddingBottom: 8 } },
        },
        MuiDialogContentText: {
            styleOverrides: { root: { color: TOKENS.inkSoft, fontSize: 13 } },
        },
        MuiAlert: {
            styleOverrides: {
                root: { borderRadius: TOKENS.radius.lg, fontSize: 13, alignItems: "center" },
                standardError: { background: TOKENS.errorContainer, color: TOKENS.errorInk },
                standardSuccess: { background: TOKENS.secondaryContainer, color: TOKENS.secondaryInk },
                standardWarning: { background: TOKENS.primaryContainer, color: TOKENS.primaryInk },
                standardInfo: { background: TOKENS.tertiaryContainer, color: TOKENS.tertiaryInk },
            },
        },
        MuiLinearProgress: {
            styleOverrides: {
                root: { height: 2, background: TOKENS.outline },
                bar: { background: TOKENS.primary },
            },
        },
        MuiTooltip: {
            styleOverrides: {
                tooltip: { background: TOKENS.inkStrong, fontSize: 12, borderRadius: TOKENS.radius.sm },
            },
        },
        MuiLink: {
            defaultProps: { underline: "hover" },
            styleOverrides: { root: { color: TOKENS.primaryInk, fontWeight: 600 } },
        },
        MuiCheckbox: {
            defaultProps: { disableRipple: true },
            styleOverrides: { root: { color: TOKENS.inkMuted } },
        },
        MuiSwitch: {
            styleOverrides: {
                root: { padding: 8 },
                track: { borderRadius: 11, background: TOKENS.outlineSolid },
            },
        },
        MuiToggleButton: {
            styleOverrides: {
                root: {
                    textTransform: "none",
                    fontSize: 12,
                    fontWeight: 600,
                    borderColor: TOKENS.outlineSolid,
                    color: TOKENS.inkSoft,
                    "&.Mui-selected": {
                        background: TOKENS.primaryContainer,
                        color: TOKENS.primaryInk,
                        "&:hover": { background: TOKENS.primaryContainer },
                    },
                },
            },
        },
    },
});
