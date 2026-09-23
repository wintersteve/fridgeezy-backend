import type { SortDirection } from "@fridgeezy/admin-contract";
import { Muted, Pill, TOKENS } from "@fridgeezy/design";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

/**
 * The console's small shared pieces, on MUI.
 *
 * `Pill` and `Muted` LEFT this file for `@fridgeezy/design` when the marketing
 * site moved onto the same theme — both have a real caller on each surface.
 * They are re-exported here so the thirty pages that already import them from
 * `../components/ui` keep working, and so a page still has one place to look.
 * Everything else below stayed: a table, a pager, a sort label and a confirm
 * dialog are console furniture with no second caller.
 *
 * One file rather than one folder per component, which is the opposite of the
 * mobile client's convention and right here: these are thin wrappers that pick
 * the right MUI component and hand it the console's own vocabulary.
 *
 * **They exist so a page never reaches for a raw MUI prop twice.** `<Pill>` is
 * what a state looks like in this tool; if every table wrote `<Chip size="small"
 * sx={{ background: … }}>` instead, the fifth one would differ from the first.
 */

/**
 * A page's title, and the line under it.
 *
 * ## Why this is a component and not two classes
 *
 * It WAS two classes — `.page-head` and `.page-lede` — and they stopped working
 * the moment the pages became MUI. `.MuiTypography-root` sets `margin: 0`, and
 * it and `.page-lede` have the same specificity (0,1,0), so the winner is
 * source order — and emotion injects its styles at runtime, after the
 * stylesheet. Every page that moved to `<Typography className="page-lede">`
 * therefore lost the 4px above and the 20px below, silently, and the filter bar
 * came to rest against the description. Measured 2026-09-23: computed
 * `marginTop: 0px`, `marginBottom: 0px`, and a gap of exactly 0 between the
 * lede and the filters. The Overview looked right only because it never
 * converted — it still draws a bare `<p>`.
 *
 * Putting the numbers in `sx` moves them to the same layer MUI's own defaults
 * live in, so the fight cannot happen again. **A class cannot safely set margin
 * on a MUI component in this app**; that is the general rule, and this is the
 * one place the page head obeys it.
 *
 * ## Two shapes, and a page picks with `dish`
 *
 * A list page is a sans title over a line of prose. A dish page is the recipe's
 * NAME in the serif over a row of state pills — the client's own rule that the
 * serif is reserved for a dish, applied here. Pills sit closer than prose does,
 * because they read as part of the title rather than as a sentence about it.
 */
export function PageHead({
    title,
    lede,
    dish = false,
    right,
}: {
    title: ReactNode;
    /** The line under the title: prose on a list page, pills on a dish page. */
    lede?: ReactNode;
    /** The title is a DISH, so it takes the serif and the larger rung. */
    dish?: boolean;
    /** Anything that belongs on the far side of the title. */
    right?: ReactNode;
}) {
    return (
        <Box sx={{ mb: dish ? 3 : 5 }}>
            <Stack
                direction="row"
                spacing={4}
                alignItems="flex-start"
                justifyContent="space-between"
            >
                <Typography
                    variant="h1"
                    sx={
                        dish
                            ? {
                                  fontFamily: TOKENS.serif,
                                  fontSize: 30,
                                  fontWeight: 600,
                                  letterSpacing: "-.4px",
                              }
                            : undefined
                    }
                >
                    {title}
                </Typography>
                {right}
            </Stack>
            {lede ? (
                <Box
                    sx={{
                        // 8px, up from 4. One step of the grid rather than a
                        // hand-picked number, and it is the ONE place the gap
                        // is written — a title over its own line is the same
                        // relationship on every page, prose or pills.
                        mt: 2,
                        maxWidth: "70ch",
                        color: TOKENS.inkSoft,
                        fontSize: 13,
                        lineHeight: 1.5,
                        // Pills are a row rather than a sentence, and without
                        // this they stack their own line boxes unevenly.
                        display: dish ? "flex" : undefined,
                        gap: dish ? 2 : undefined,
                        flexWrap: dish ? "wrap" : undefined,
                        alignItems: dish ? "center" : undefined,
                    }}
                >
                    {lede}
                </Box>
            ) : null}
        </Box>
    );
}

/**
 * The frame every detail page draws: a way back, then the page.
 *
 * ## Why every entity has one of these now
 *
 * Ingredients and tags edited INLINE until 2026-09-23, and the argument for
 * that was recorded and is worth keeping: an ingredient has four editable
 * fields and no children, so a route each way to change one number is ceremony
 * on the screen most likely to be used for a long pass of small corrections.
 *
 * What it missed is that the question is almost never "change this number". It
 * is "is this the row everything joins on, or the duplicate?" — and that is
 * answered by the dishes using the ingredient, which no table cell has room
 * for. So the page is not a bigger form; it is the form plus the one list that
 * makes the form answerable.
 *
 * **The cost the old note named is real and is now paid**: a long correction
 * pass costs two navigations per row. If that bites, the answer is a keyboard
 * path through the list, not the inline editor coming back.
 */
export function DetailPage({
    backTo,
    backLabel,
    children,
}: {
    backTo: string;
    backLabel: string;
    children: ReactNode;
}) {
    return (
        <>
            <Box sx={{ mb: 3 }}>
                <Link to={backTo}>← {backLabel}</Link>
            </Box>
            {children}
        </>
    );
}

/**
 * The two columns every detail page is built from, and the GAP between the
 * cards in them.
 *
 * ## The gap belongs here, not on each card
 *
 * It was `sx={{ mt: 4 }}` on every `Paper` after the first — written twelve
 * times across four pages, and forgotten entirely on the fifth, which is how
 * the recipe page came to have eight cards flush against each other. A number
 * repeated at every call site is a number that will be missed at one of them;
 * the columns are `Stack`s now and the cards carry nothing.
 *
 * `spacing={4}` is 16px, the same distance `.detail` puts between the two
 * columns — so a card's neighbour is equally far away whether it is beside or
 * below.
 *
 * Conditional cards cost nothing: a branch returning `null` renders no DOM
 * node, so it takes no gap either.
 */
export function DetailLayout({
    main,
    aside,
}: {
    main: ReactNode;
    aside: ReactNode;
}) {
    return (
        <div className="detail">
            <Stack spacing={4}>{main}</Stack>
            <Stack spacing={4} component="aside">
                {aside}
            </Stack>
        </div>
    );
}

/**
 * A read-only fact list — the right-hand column of every detail page.
 *
 * A `<dl>` rather than rows of `<Typography>`, because that is what it is: a
 * term and its value. The stylesheet draws the rule between pairs.
 */
export function Facts({ children }: { children: ReactNode }) {
    return <dl>{children}</dl>;
}

export function Fact({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="kv">
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

/**
 * The bar that appears once something is unsaved.
 *
 * Sticky at the foot rather than a button beside each field: a detail page here
 * edits several fields at once and sends ONE patch, so there is one moment of
 * commitment and it has to be reachable from wherever the reader has scrolled
 * to.
 */
export function SaveBar({
    count,
    busy,
    blocked,
    onDiscard,
    onSave,
}: {
    count: number;
    busy?: boolean;
    /** Why the save cannot go, said HERE rather than left to the server. */
    blocked?: string;
    onDiscard: () => void;
    onSave: () => void;
}) {
    if (count === 0) return null;

    return (
        <Box className="save-bar">
            {/* The reason replaces the count rather than joining it: a reader
                whose save is refused needs to know why, and "3 unsaved changes"
                is not an answer to that. */}
            <span
                className="state"
                style={blocked ? { color: TOKENS.errorInk } : undefined}
            >
                {blocked ?? `${count} unsaved change${count === 1 ? "" : "s"}`}
            </span>
            <Button variant="text" onClick={onDiscard} disabled={busy}>
                Discard
            </Button>
            <Button variant="contained" onClick={onSave} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
            </Button>
        </Box>
    );
}

/**
 * The state a list or a page is in, drawn once so every screen reports the
 * same way.
 *
 * `loading` is the FIRST load only. A reload keeps its rows and draws the bar
 * instead, which is what stops a table blinking every time a row is edited.
 *
 * The bar is an indeterminate `LinearProgress` rather than a spinner: it sits
 * on the edge of the card it is refreshing, so it reports without taking a
 * position in the layout the rows would then move around.
 */
export function ResourceState({
    loading,
    fetching,
    error,
    empty,
    emptyTitle = "Nothing here",
    emptyLine,
    children,
}: {
    loading: boolean;
    fetching?: boolean;
    error?: string;
    empty?: boolean;
    emptyTitle?: string;
    emptyLine?: string;
    children: ReactNode;
}) {
    if (error) {
        return <Alert severity="error">{error}</Alert>;
    }

    if (loading) {
        return (
            <Box sx={{ py: 16, textAlign: "center", color: TOKENS.inkSoft }}>
                <LinearProgress sx={{ mb: 4 }} />
                Loading…
            </Box>
        );
    }

    if (empty) {
        return (
            <Box sx={{ py: 16, textAlign: "center" }}>
                <Typography variant="h3" sx={{ mb: 2 }}>
                    {emptyTitle}
                </Typography>
                {emptyLine ? (
                    <Typography variant="body2" sx={{ color: TOKENS.inkSoft }}>
                        {emptyLine}
                    </Typography>
                ) : null}
            </Box>
        );
    }

    return (
        <>
            {/* Drawn in the flow rather than absolutely, so the two-pixel bar
                never sits on top of the first row's text. */}
            {fetching ? <LinearProgress /> : null}
            {children}
        </>
    );
}

/**
 * Paging.
 *
 * Deliberately NOT `TablePagination`: that component owns a rows-per-page
 * select and a jump-to-first control, and this console has one page size,
 * decided per screen by a constant. What is wanted is the sentence and two
 * buttons.
 */
export function Pager({
    total,
    limit,
    offset,
    onChange,
}: {
    total: number;
    limit: number;
    offset: number;
    onChange: (offset: number) => void;
}) {
    if (total <= limit) return null;

    const from = offset + 1;
    const to = Math.min(offset + limit, total);

    return (
        <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            justifyContent="flex-end"
            sx={{ p: 3, borderTop: `1px solid ${TOKENS.outline}` }}
        >
            <Typography
                variant="body2"
                sx={{ mr: "auto", color: TOKENS.inkSoft }}
            >
                {from}–{to} of {total}
            </Typography>
            <Button
                size="small"
                variant="outlined"
                disabled={offset === 0}
                onClick={() => onChange(Math.max(offset - limit, 0))}
            >
                Previous
            </Button>
            <Button
                size="small"
                variant="outlined"
                disabled={to >= total}
                onClick={() => onChange(offset + limit)}
            >
                Next
            </Button>
        </Stack>
    );
}

/**
 * A column header that sorts the WHOLE result, not the page on screen.
 *
 * That is the constraint the design follows from. Every list here is paged
 * server-side — fifty of four hundred — so a header that reordered the rows in
 * the browser would sort a twentieth of the table while claiming to sort it,
 * and the answer would change depending on which page you happened to be on.
 * So a press sets `sort`/`dir` in the URL, the request goes again, and only
 * columns the API can genuinely order by are drawn as buttons. A header with
 * no server sort behind it is a plain `TableCell` rather than a control that
 * lies.
 *
 * `first` is the direction a column asks for when it is pressed from cold, and
 * it differs by what the column holds: a name wants A–Z, a count wants the
 * biggest first, a date wants the newest. Pressing the column that is already
 * sorted reverses it.
 *
 * `TableSortLabel` carries `aria-sort` on the cell and the arrow for free,
 * which is the half of this that was hand-written before.
 */
export function SortTh({
    column,
    label,
    sort,
    dir,
    first = "asc",
    align,
    onSort,
}: {
    column: string;
    label: string;
    sort: string;
    dir: SortDirection;
    first?: SortDirection;
    align?: "left" | "right";
    onSort: (column: string, dir: SortDirection) => void;
}) {
    const active = sort === column;
    const next: SortDirection = active
        ? dir === "asc"
            ? "desc"
            : "asc"
        : first;

    return (
        <TableCell align={align} sortDirection={active ? dir : false}>
            <TableSortLabel
                active={active}
                direction={active ? dir : first}
                onClick={() => onSort(column, next)}
            >
                {label}
            </TableSortLabel>
        </TableCell>
    );
}

/**
 * A confirmation that requires the thing's NAME to be typed.
 *
 * Used for deletes and nothing else. An "are you sure?" with a button is a
 * reflex people learn to click through in a week; typing the dish's name is a
 * few seconds that cannot be done by accident, and it makes the reader read
 * what they are about to destroy.
 *
 * **Escape, the focus trap and returning focus to whatever opened it are MUI's
 * now**, and that is most of why the library is here. The hand-written version
 * had to capture the opener during RENDER (React applies `autoFocus` in the
 * commit, so an effect-time read captures the dialog's own field and restoring
 * it sends focus to `<body>`) and schedule the restore a tick late so
 * StrictMode's double-invoked effect could cancel it. Both are real bugs that
 * were found by testing, and neither is code anybody should be maintaining
 * here.
 */
export function ConfirmDelete({
    what,
    name,
    warning,
    busy,
    onCancel,
    onConfirm,
    typed,
    onTyped,
}: {
    what: string;
    name: string;
    warning?: ReactNode;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    typed: string;
    onTyped: (value: string) => void;
}) {
    const matches = typed.trim() === name.trim();
    const field = useRef<HTMLInputElement>(null);

    return (
        <Dialog
            open
            onClose={onCancel}
            maxWidth="xs"
            fullWidth
            // `autoFocus` on the field is NOT enough and was measured not to
            // work: the dialog's own focus trap takes focus to the paper when
            // it mounts, after React has applied it, so the reader lands on a
            // `<div>` and their first keystroke goes nowhere. `onEntered` is
            // the documented moment — it also means focus arrives when the
            // dialog has finished travelling rather than during.
            slotProps={{
                transition: { onEntered: () => field.current?.focus() },
            }}
        >
            <DialogTitle>Delete this {what}?</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 4 }}>
                    This cannot be undone. {warning}
                </DialogContentText>
                <TextField
                    fullWidth
                    inputRef={field}
                    value={typed}
                    onChange={(event) => onTyped(event.target.value)}
                    label={`Type ${name} to confirm`}
                    // Enter is the obvious way to finish typing a name, and
                    // without this it does nothing at all — the field is not in
                    // a form, so there is no implicit submit to inherit.
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && matches && !busy)
                            onConfirm();
                    }}
                />
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4 }}>
                <Button variant="text" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    variant="outlined"
                    color="error"
                    disabled={!matches || busy}
                    onClick={onConfirm}
                >
                    {busy ? "Deleting…" : `Delete ${what}`}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * The bar of filters over a list.
 *
 * Every list screen has one and they had each laid it out themselves, which is
 * how one of them ends up with a different gap. The trailing count is a SLOT
 * rather than a child, so it is always on the far edge whatever the caller put
 * before it.
 */
export function FilterBar({
    count,
    children,
}: {
    count?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Stack
            direction="row"
            spacing={3}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 5 }}
        >
            {children}
            {count ? (
                <Typography
                    variant="body2"
                    sx={{ ml: "auto", color: TOKENS.inkSoft }}
                >
                    {count}
                </Typography>
            ) : null}
        </Stack>
    );
}

/** The search field every list opens with. */
export function SearchField({
    value,
    onChange,
    label,
    placeholder = "Search by name…",
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder?: string;
}) {
    return (
        <TextField
            type="search"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            sx={{ minWidth: 240 }}
        />
    );
}

/**
 * A filter dropdown.
 *
 * `""` is a real option here and means "no filter", which is why the options
 * are passed as pairs rather than as bare strings: the empty value needs a
 * label ("Any level") and a bare list could not carry one.
 */
export function FilterSelect({
    value,
    onChange,
    label,
    options,
    width = 170,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    options: readonly { value: string; label: string }[];
    width?: number;
}) {
    return (
        <TextField
            select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            sx={{ minWidth: width }}
            slotProps={{ select: { displayEmpty: true } }}
        >
            {options.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                    {option.label}
                </MenuItem>
            ))}
        </TextField>
    );
}

/**
 * A table row that opens something.
 *
 * ## The whole row is the target, and the name is still a real link
 *
 * Both, deliberately. The row press is the app's own idiom — "press the row →
 * open the recipe, what a row press does everywhere else" — and it replaces an
 * `Open` button that was a second control for the thing the row already meant.
 * But a clickable `<tr>` is not focusable, is not announced as a link, and
 * cannot be cmd-clicked into a new tab, so the NAME stays an `<a>`: that is
 * where the semantics live, and the row is the hit target around it.
 *
 * A click that started on a control inside the row is left alone — otherwise
 * the link would navigate and this would navigate again, and any future button
 * in a row would fire its own action AND open the page.
 */
export function LinkRow({ to, children }: { to: string; children: ReactNode }) {
    const navigate = useNavigate();

    return (
        <TableRow
            hover
            sx={{ cursor: "pointer" }}
            onClick={(event) => {
                const origin = event.target as HTMLElement;

                if (origin.closest("a, button, input, select, [role='button']"))
                    return;

                navigate(to);
            }}
        >
            {children}
        </TableRow>
    );
}

/**
 * A table, with its header row and its own horizontal scroll.
 *
 * `TableContainer` is what keeps a wide table from widening the PAGE, which is
 * the thing the hand-rolled `.table-wrap` was for.
 */
export function DataTable({
    head,
    children,
}: {
    head: ReactNode;
    children: ReactNode;
}) {
    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>{head}</TableRow>
                </TableHead>
                <TableBody>{children}</TableBody>
            </Table>
        </TableContainer>
    );
}

export { Muted, Pill };
