import type { SortDirection } from "@fridgeezy/admin-contract";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
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

import { TOKENS } from "../theme";

/**
 * The console's small shared pieces, on MUI.
 *
 * One file rather than one folder per component, which is the opposite of the
 * mobile client's convention and right here: these are thin wrappers that pick
 * the right MUI component and hand it the console's own vocabulary.
 *
 * **They exist so a page never reaches for a raw MUI prop twice.** `<Pill>` is
 * what a state looks like in this tool; if every table wrote `<Chip size="small"
 * sx={{ background: … }}>` instead, the fifth one would differ from the first.
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

export function Pill({
    tone = "neutral",
    children,
}: {
    tone?: keyof typeof PILL_TONE;
    children: ReactNode;
}) {
    return <Chip size="small" label={children} sx={PILL_TONE[tone]} />;
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
            <Typography variant="body2" sx={{ mr: "auto", color: TOKENS.inkSoft }}>
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
    const next: SortDirection = active ? (dir === "asc" ? "desc" : "asc") : first;

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
            slotProps={{ transition: { onEntered: () => field.current?.focus() } }}
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
                        if (event.key === "Enter" && matches && !busy) onConfirm();
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
 * A quiet line — a caption, a value that is absent, a sentence under a
 * heading. It is the console's `--ink-muted` in one place rather than an `sx`
 * on thirty cells, and it renders as a `<span>` so it can sit inside a
 * sentence as well as under one.
 */
export function Muted({ children }: { children: ReactNode }) {
    return (
        <Typography component="span" variant="caption" sx={{ color: TOKENS.inkMuted }}>
            {children}
        </Typography>
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
export function FilterBar({ count, children }: { count?: ReactNode; children: ReactNode }) {
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
                <Typography variant="body2" sx={{ ml: "auto", color: TOKENS.inkSoft }}>
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

/** A checkbox filter — a working list rather than a narrowing of one. */
export function CheckFilter({
    checked,
    onChange,
    label,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}) {
    return (
        <FormControlLabel
            control={
                <Checkbox
                    size="small"
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                />
            }
            label={label}
            slotProps={{ typography: { fontSize: 13 } }}
        />
    );
}

/**
 * A table, with its header row and its own horizontal scroll.
 *
 * `TableContainer` is what keeps a wide table from widening the PAGE, which is
 * the thing the hand-rolled `.table-wrap` was for.
 */
export function DataTable({ head, children }: { head: ReactNode; children: ReactNode }) {
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
