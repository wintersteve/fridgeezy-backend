import {
    MISE_SLOT,
    STEP_ART_COST_USD,
    type AdminStepArtRow,
    type AdminStepArtState,
    type DrawStepArtResponse,
    type Page,
} from "@fridgeezy/admin-contract";
import { TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";

import { BillingBadge } from "../components/billing-badge";
import { useToast } from "../components/toast";
import { DataTable, FilterBar, FilterSelect, Muted, PageHead, Pager, Pill, ResourceState, SearchField, SortTh } from "../components/ui";
import { api, queryString } from "../lib/api";
import { bustCache } from "../lib/format";
import { useListParams } from "../lib/use-list-params";
import { useDebounced, useResource } from "../lib/use-resource";

const money = (amount: number) => `$${amount.toFixed(2)}`;

const ART_FILTER = [
    { value: "any", label: "Any" },
    { value: "none", label: "No step illustrations" },
    { value: "some", label: "Has some" },
] as const;

/**
 * Cook-mode step illustrations, drawn one dish at a time.
 *
 * ## The only screen here that spends money, so it says so everywhere
 *
 * ~$0.067 a render, six to twelve steps a recipe. Every button that costs
 * something carries its price IN THE LABEL rather than in a confirmation
 * afterwards — a dialog that appears once the reader has decided is a thing to
 * click through, where a number on the button is part of the decision.
 *
 * `RECIPE_STEP_ART_ENABLED` deliberately does not gate this. That flag governs
 * drawing art automatically for EVERY dish the app writes, which at this price
 * is indefensible; choosing a handful of dishes by hand is the whole reason
 * this screen exists, and the API's own note says so.
 *
 * ## It is a BROWSER, and that is a reversal
 *
 * It opened on an empty search box, on the argument that "which dish should
 * have step art" is a judgement about a recipe somebody already has in mind.
 * That is true of half the visits and useless for the other half: the question
 * this screen actually gets asked is "which dishes have none", which is a
 * filter over the catalogue rather than a lookup. So the list is the page and
 * the search narrows it.
 *
 * **Hidden dishes are absent entirely**, not offered as a filter. Paying $0.40
 * to illustrate a method no reader can reach is the one mistake this screen
 * should make impossible.
 *
 * The selected dish's method opens BELOW the list rather than replacing it, so
 * working through several is scrolling rather than navigating back and forth.
 */
const PAGE_SIZE = 25;

export function StepArtPage() {
    const { params, setParams, get, setParam, setSort, sort, dir, offset } = useListParams({
        sort: "createdAt",
        dir: "desc",
        clearOnChange: ["recipe"],
    });
    const recipeId = get("recipe");
    const art = get("art", "any");
    const query = get("query");

    const debouncedQuery = useDebounced(query);

    /**
     * The method panel, so selecting a dish can bring it into view.
     *
     * It sits BELOW the list — which is right, because it keeps your place in
     * the list while you work through several — and that is exactly what made
     * selecting look broken: 25 rows is about two thousand pixels, so the panel
     * appeared far off screen and the press had no visible effect at all.
     *
     * On the wrapper rather than on the panel itself, because the wrapper is
     * rendered on BOTH branches of the conditional below. A ref on the panel
     * would be null at the moment of the very first selection, which is the one
     * press that most needs the feedback.
     */
    const methodRef = useRef<HTMLDivElement>(null);

    /**
     * Bumped by every press that should bring the method into view.
     *
     * A counter rather than a boolean, because the SAME dish being pressed
     * twice has to scroll twice — which is the whole of what a press on the
     * row that is already open can mean.
     */
    const [revealNonce, setRevealNonce] = useState(0);

    /**
     * True when the page was OPENED with a dish already named in the URL — a
     * reload, or a shared link — and that arrival has not been scrolled to yet.
     *
     * A ref rather than state because it is a latch, not something to render.
     */
    const pendingArrival = useRef(Boolean(recipeId));

    const toast = useToast();
    const [busy, setBusy] = useState<string>();
    const [artToken, setArtToken] = useState(0);

    const recipes = useResource(
        () =>
            api.get<Page<AdminStepArtRow>>(
                `/step-art/recipes${queryString({
                    query: debouncedQuery,
                    art,
                    sort,
                    dir,
                    limit: PAGE_SIZE,
                    offset,
                })}`
            ),
        [debouncedQuery, art, sort, dir, offset]
    );

    const steps = useResource(
        () =>
            recipeId
                ? api.get<AdminStepArtState>(`/recipes/${recipeId}/step-art`)
                : Promise.resolve(null),
        [recipeId]
    );

    const revealMethod = () => {
        /*
          `auto`, NOT `smooth`, and this is not a style preference.

          `behavior: "smooth"` is a SILENT no-op in some browsers and contexts —
          measured here at 0px of movement from the same call that moves 2336px
          with `auto`, on the same element in the same page. It does not throw
          and it does not warn; the scroll simply never happens, which is
          exactly the "I pressed it and nothing happened" this function was
          written to fix. There is no way to feature-detect it either, because
          the call returns void whether or not it animates.

          A 2300px ride is also the wrong interaction for this distance. What
          orients the reader is the dish's name arriving as a serif masthead and
          the row they pressed staying highlighted behind them, not watching the
          page travel. Instant is the reduced-motion answer as well, so this
          needs no branch.
        */
        methodRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    };

    /**
     * Selecting a dish, and the reason it is one handler rather than an inline
     * `setParams`.
     *
     * Pressing the row of the dish that is ALREADY open writes the same id,
     * which is not a state change — so without this the second press did
     * nothing whatever, on a row that plainly invites one. Scrolling on every
     * press makes both presses mean the same thing: show me this method.
     */
    const selectRecipe = (id: string) => {
        if (id !== recipeId) {
            const next = new URLSearchParams(params);

            next.set("recipe", id);
            setParams(next, { replace: true });
            setArtToken(0);
        }

        // Scrolling happens in the effect below, not here.
        //
        // This was `requestAnimationFrame(revealMethod)` and it NEVER RAN: rAF
        // is tied to painting, and a browser suspends painting for a tab that
        // is not visible — measured here as `visibilityState: "hidden"`,
        // `rafFired: false`, `timeoutFired: true`. It fails silently and it
        // fails exactly where the press most needs to do something.
        //
        // An effect is the right tool regardless: React runs it after the
        // commit whether or not anything is painted, which is what "after the
        // panel exists" actually means.
        setRevealNonce((nonce) => nonce + 1);
    };

    const draw = async (label: string, body: Record<string, unknown>) => {
        setBusy(label);

        try {
            const result = await api.post<DrawStepArtResponse>(
                `/recipes/${recipeId}/step-art`,
                body
            );

            // The URL of a redrawn step does not change — the key is
            // `<recipe>/<step>.webp` — so the browser would keep the picture it
            // already has. Same cache-buster the hero regeneration uses, and
            // for the same reason: applied to the `<img>` here, never written
            // to storage or to a row.
            setArtToken(Date.now());
            steps.reload();
            // The row's `3 of 8` is now stale too.
            recipes.reload();

            if (result.drawn === 0 && result.skipped > 0) {
                toast.show(
                    "warn",
                    `Nothing drawn — all ${result.skipped} step(s) already had a picture. Use "Redraw" to replace them.`
                );
            } else {
                toast.show(
                    result.failed ? "warn" : "ok",
                    `Drew ${result.drawn} step(s) for ${result.dish}` +
                        (result.failed ? `, ${result.failed} failed` : "") +
                        `. Spent ${money(result.costUsd)}.`
                );
            }
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    useEffect(() => {
        // A press. Includes a press on the row already open, which changes no
        // other state at all and still has to bring the method back into view.
        if (revealNonce) {
            revealMethod();

            return;
        }

        /*
          Arrival by URL, and it has to wait for BOTH reads.

          Scrolling as soon as the METHOD landed put the viewport at 80px: the
          two requests race, the method usually wins, and at that moment the
          list is still empty — so the panel sits near the top of a short page
          and "scroll to it" barely moves. The list then arrives, grows the page
          by two thousand pixels, and carries the panel away while the viewport
          stays where it was.

          The target has to stop moving before it is worth scrolling to, and it
          stops moving when the list above it has its rows.
        */
        if (pendingArrival.current && steps.data && recipes.data) {
            pendingArrival.current = false;
            revealMethod();
        }
        // `revealMethod` only reads a ref, so it is not state to re-run on.
        // eslint-disable-next-line
    }, [revealNonce, steps.data?.recipeId, recipes.data]);

    const state = steps.data;
    const drawnCount = state ? state.steps.length - state.missing : 0;

    return (
        <>
            <PageHead
                title="Step illustrations"
                lede={
                    <>
                        One picture per method step, shown in cook mode. Costs about{" "}
                        {money(STEP_ART_COST_USD)} a step — roughly{" "}
                        {money(STEP_ART_COST_USD * 8)} for a typical method — so it is
                        drawn for dishes you choose rather than for everything.
                    </>
                }
            />

            <FilterBar count={recipes.data ? `${recipes.data.total} matching` : null}>
                <SearchField
                    value={query}
                    onChange={(value) => setParam("query", value)}
                    label="Search recipes"
                />
                <FilterSelect
                    value={art}
                    onChange={(value) => setParam("art", value)}
                    label="Step art"
                    width={210}
                    options={ART_FILTER}
                />
            </FilterBar>

            <Paper className="section-block">
                <ResourceState
                    loading={recipes.loading}
                    fetching={recipes.fetching}
                    error={recipes.error}
                    empty={recipes.data?.rows.length === 0}
                    emptyTitle="No recipes match"
                    emptyLine="Widen the search, or switch the filter back to Any."
                >
                    <DataTable
                        head={
                            <>
                                <TableCell className="col-thumb">Art</TableCell>
                                    <SortTh
                                        column="name"
                                        label="Dish"
                                        sort={sort}
                                        dir={dir}
                                        onSort={setSort}
                                    />
                                {/* Steps, Illustrated and To finish are
                                    counted per page from storage, so there is
                                    nothing for the database to order the whole
                                    catalogue by. The "No step illustrations"
                                    filter above is the working list they would
                                    be sorted for. */}
                                <TableCell align="right">Steps</TableCell>
                                <TableCell>Illustrated</TableCell>
                                <TableCell align="right">To finish</TableCell>
                            </>
                        }
                    >
                                {recipes.data?.rows.map((row) => {
                                    const remaining = Math.max(row.stepCount - row.drawnCount, 0);

                                    return (
                                        // Not a `LinkRow`: this row does not
                                        // navigate. It opens the method BELOW
                                        // the list, which is the whole shape of
                                        // this screen — working through several
                                        // dishes is scrolling rather than going
                                        // back and forth. A dish with no method
                                        // has nothing to open, so its row takes
                                        // no press and says so with the cursor.
                                        <TableRow
                                            key={row.id}
                                            hover={row.stepCount > 0}
                                            selected={row.id === recipeId}
                                            sx={{
                                                cursor:
                                                    row.stepCount > 0 ? "pointer" : "default",
                                            }}
                                            onClick={() => {
                                                if (row.stepCount > 0) selectRecipe(row.id);
                                            }}
                                        >
                                            <TableCell>
                                                {row.image ? (
                                                    <img
                                                        className="thumb"
                                                        src={row.image}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="thumb empty">—</div>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <span className="dish">{row.name}</span>
                                            </TableCell>
                                            <TableCell align="right">
                                                {row.stepCount || "—"}
                                            </TableCell>
                                            <TableCell>
                                                {row.stepCount === 0 ? (
                                                    <Muted>no method</Muted>
                                                ) : row.drawnCount === 0 ? (
                                                    <Muted>none</Muted>
                                                ) : row.drawnCount >= row.stepCount ? (
                                                    <Pill tone="live">all {row.stepCount}</Pill>
                                                ) : (
                                                    <Pill tone="accent">
                                                        {row.drawnCount} of {row.stepCount}
                                                    </Pill>
                                                )}
                                            </TableCell>
                                            {/* The price of finishing this dish, on the row.
                                                It is the number the filter exists to find, and
                                                putting it here means the cost is visible before
                                                anything is opened. */}
                                            <TableCell
                                                align="right"
                                                sx={{ color: TOKENS.inkMuted }}
                                            >
                                                {remaining > 0
                                                    ? money(remaining * STEP_ART_COST_USD)
                                                    : "—"}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                    </DataTable>
                    <Pager
                        total={recipes.data?.total ?? 0}
                        limit={PAGE_SIZE}
                        offset={offset}
                        onChange={(next) => setParam("offset", String(next))}
                    />
                </ResourceState>
            </Paper>

            <div ref={methodRef}>
            {!recipeId ? (
                <Paper>
                    <Box sx={{ py: 16, textAlign: "center" }}>
                        <Typography variant="h3" sx={{ mb: 2 }}>
                            No dish selected
                        </Typography>
                        <Muted>Pick one above to see its method and draw its pictures.</Muted>
                    </Box>
                </Paper>
            ) : (
                <ResourceState loading={steps.loading} fetching={steps.fetching} error={steps.error}>
                    {state ? (
                        <>
                            <PageHead
                                dish
                                title={state.dish}
                                lede={
                                    <>
                                        <span>
                                            {drawnCount} of {state.steps.length} steps drawn
                                        </span>
                                        {state.missing > 0 ? (
                                            <Pill tone="accent">{state.missing} missing</Pill>
                                        ) : (
                                            <Pill tone="live">complete</Pill>
                                        )}
                                    </>
                                }
                            />

                            <Stack
                                direction="row"
                                spacing={3}
                                alignItems="center"
                                flexWrap="wrap"
                                useFlexGap
                                sx={{ mb: 4 }}
                            >
                                <Button
                                    variant="contained"
                                    disabled={Boolean(busy) || state.missing === 0}
                                    onClick={() => void draw("missing", {})}
                                >
                                    {busy === "missing"
                                        ? "Drawing…"
                                        : `Draw ${state.missing} missing · ${money(
                                              state.missing * STEP_ART_COST_USD
                                          )}`}
                                </Button>
                                <Button
                                    variant="outlined"
                                    disabled={Boolean(busy) || state.steps.length === 0}
                                    onClick={() => void draw("all", { force: true })}
                                >
                                    {busy === "all"
                                        ? "Redrawing…"
                                        : `Redraw all ${state.steps.length} · ${money(
                                              state.steps.length * STEP_ART_COST_USD
                                          )}`}
                                </Button>
                                <Box sx={{ ml: "auto" }}>
                                    <BillingBadge billing={state.billing} />
                                </Box>
                            </Stack>

                            <Paper>
                                {state.steps.map((step) => (
                                    <div
                                        className={`step-art-row${
                                            step.slot === MISE_SLOT ? " mise" : ""
                                        }`}
                                        key={step.slot}
                                    >
                                        {/* The gathering page has no number
                                            because it is not a step — it has no
                                            `recipe_instructions` row. A glyph
                                            rather than a "0", which would imply
                                            it sits in the same sequence. */}
                                        <div className="n">
                                            {step.slot === MISE_SLOT ? "◍" : step.slot}
                                        </div>
                                        <div className="art">
                                            {step.url ? (
                                                <img
                                                    src={bustCache(step.url, artToken)}
                                                    alt=""
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="none">not drawn</div>
                                            )}
                                        </div>
                                        <div>
                                            {step.title ? (
                                                <div className="cell-title">{step.title}</div>
                                            ) : null}
                                            {/* For mise this is the ingredient
                                                list the picture is drawn from,
                                                not a sentence — see the
                                                contract. */}
                                            <Muted>{step.instructionText}</Muted>
                                        </div>
                                        <div className="actions">
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                disabled={Boolean(busy)}
                                                onClick={() =>
                                                    void draw(`slot-${step.slot}`, {
                                                        slots: [step.slot],
                                                        force: true,
                                                    })
                                                }
                                            >
                                                {busy === `slot-${step.slot}`
                                                    ? "Drawing…"
                                                    : step.url
                                                      ? "Redraw"
                                                      : "Draw"}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {state.steps.length === 0 ? (
                                    <Box sx={{ py: 16, textAlign: "center" }}>
                                        <Typography variant="h3" sx={{ mb: 2 }}>
                                            This recipe has no steps
                                        </Typography>
                                        <Muted>There is nothing to illustrate.</Muted>
                                    </Box>
                                ) : null}
                            </Paper>
                        </>
                    ) : null}
                </ResourceState>
            )}
            </div>
        </>
    );
}
