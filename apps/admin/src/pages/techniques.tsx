import {
    TECHNIQUE_ART_BATCH_MAX,
    TECHNIQUE_ART_COST_USD,
    type AdminTechniqueState,
    type DrawTechniqueArtResponse,
} from "@fridgeezy/admin-contract";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { BillingBadge } from "../components/billing-badge";
import { useToast } from "../components/toast";
import { FilterBar, FilterSelect, Muted, PageHead, Pill, ResourceState } from "../components/ui";
import { api } from "../lib/api";
import { bustCache } from "../lib/format";
import { useResource } from "../lib/use-resource";

const money = (amount: number) => `$${amount.toFixed(2)}`;

/**
 * Technique paintings — the closed vocabulary, and what is left to draw.
 *
 * ## Why this screen is a better bargain than step art
 *
 * The verbs are a curated ~148 rows and the generator refuses anything outside
 * them, so the whole feature converges on about ten dollars and then stops
 * costing anything, ever. Step art's arithmetic never ends: $0.40-$0.80 per
 * dish, for as many dishes as exist.
 *
 * What is being bought is a WAIT, not a picture. Technique art is drawn on the
 * first request for each verb, so today somebody standing at a hob waits for a
 * render to find out what "deglaze" means. Finishing the set retires that.
 *
 * ## It draws a BATCH at a time, and the number is not arbitrary
 *
 * A render is ~10s at three concurrent, so twelve is about forty seconds —
 * inside Lambda's ceiling. All 139 at once is eight minutes and a timeout. So
 * the button says how many it is about to draw and what that costs, and you
 * press it again. The spend stays visible a batch at a time rather than
 * arriving as one number at the end.
 */
export function TechniquesPage() {
    const [params, setParams] = useSearchParams();
    const filter = params.get("art") ?? "missing";
    const category = params.get("category") ?? "";

    const toast = useToast();
    const [busy, setBusy] = useState<string>();
    const [artToken, setArtToken] = useState(0);

    const state = useResource(() => api.get<AdminTechniqueState>("/techniques"), []);

    const setParam = (key: string, value: string | null) => {
        const next = new URLSearchParams(params);

        if (!value) next.delete(key);
        else next.set(key, value);

        setParams(next, { replace: true });
    };

    const all = state.data?.techniques ?? [];

    const categories = [...new Set(all.map((t) => t.category).filter(Boolean))].sort();

    const visible = all.filter((technique) => {
        if (category && technique.category !== category) return false;
        if (filter === "missing") return !technique.url;
        if (filter === "drawn") return Boolean(technique.url);

        return true;
    });

    /** What the next press would draw: the visible, undrawn ones, capped. */
    const nextBatch = visible
        .filter((technique) => !technique.url)
        .slice(0, TECHNIQUE_ART_BATCH_MAX)
        .map((technique) => technique.name);

    /** Undrawn verbs matching the current filter, beyond the next batch. */
    const remainingAfterBatch =
        visible.filter((technique) => !technique.url).length - nextBatch.length;

    const draw = async (label: string, actions: string[], force = false) => {
        if (!actions.length) return;

        setBusy(label);

        try {
            const result = await api.post<DrawTechniqueArtResponse>("/techniques/art", {
                actions,
                force,
            });

            // A redrawn verb keeps its URL — the key is `<action>.webp` — so the
            // browser would show the painting it already has. Same cache-buster
            // the other art screens use, on the `<img>` only.
            setArtToken(Date.now());
            state.reload();

            const failures = result.results.filter((entry) => entry.error);

            toast.show(
                failures.length ? "warn" : "ok",
                `Drew ${result.drawn}` +
                    (result.skipped ? `, skipped ${result.skipped} already done` : "") +
                    (failures.length
                        ? `, ${failures.length} failed (${failures
                              .map((entry) => entry.action)
                              .join(", ")})`
                        : "") +
                    `. Spent ${money(result.costUsd)}.`
            );
        } catch (cause) {
            toast.show("error", (cause as Error).message);
        } finally {
            setBusy(undefined);
        }
    };

    return (
        <>
            <PageHead
                title="Technique illustrations"
                lede="One painting per cooking verb, shown when a cook taps a technique in a method. Drawn on first request today — so the first person to meet a verb waits at the hob for it. The vocabulary is closed, so finishing the set retires that wait for good."
            />


            <ResourceState loading={state.loading} fetching={state.fetching} error={state.error}>
                {state.data ? (
                    <>
                        <div className="grid cols-4 section-block">
                            <div className="card stat">
                                <div className="label">Vocabulary</div>
                                <div className="value">{state.data.total}</div>
                                <div className="note">verbs a method can reference</div>
                            </div>
                            <div className="card stat">
                                <div className="label">Drawn</div>
                                <div className="value">{state.data.drawn}</div>
                                <div className="note">no reader ever waits for these</div>
                            </div>
                            <div className={`card stat ${state.data.missing ? "" : "clear"}`}>
                                <div className="label">Missing</div>
                                <div className="value">{state.data.missing}</div>
                                <div className="note">
                                    {state.data.missing
                                        ? "first reader of each still pays the wait"
                                        : "the set is complete"}
                                </div>
                            </div>
                            <div className="card stat clear">
                                <div className="label">To finish</div>
                                <div className="value">
                                    {money(state.data.missing * TECHNIQUE_ART_COST_USD)}
                                </div>
                                <div className="note">once, for all time</div>
                            </div>
                        </div>

                        <FilterBar count={`${visible.length} shown`}>
                            <FilterSelect
                                value={filter}
                                onChange={(value) => setParam("art", value)}
                                label="Drawn state"
                                options={DRAWN_STATE}
                            />
                            <FilterSelect
                                value={category}
                                onChange={(value) => setParam("category", value)}
                                label="Category"
                                width={190}
                                options={[
                                    { value: "", label: "Any category" },
                                    ...categories.map((name) => ({
                                        value: name as string,
                                        label: name as string,
                                    })),
                                ]}
                            />
                        </FilterBar>

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
                                disabled={Boolean(busy) || nextBatch.length === 0}
                                onClick={() => void draw("batch", nextBatch)}
                            >
                                {busy === "batch"
                                    ? "Drawing…"
                                    : nextBatch.length
                                      ? `Draw next ${nextBatch.length} · ${money(
                                            nextBatch.length * TECHNIQUE_ART_COST_USD
                                        )}`
                                      : "Nothing left to draw"}
                            </Button>
                            {/* Counted off what is VISIBLE, not off the whole
                                vocabulary, and shown only when there is a batch to
                                follow. Reading `state.data.missing` said "137 more
                                after this batch" beside a button reading "nothing
                                left to draw" — true of the vocabulary, nonsense
                                about the filter the reader is actually looking
                                at. */}
                            {nextBatch.length && remainingAfterBatch > 0 ? (
                                <Muted>{remainingAfterBatch} more after this batch</Muted>
                            ) : null}
                            <Box sx={{ ml: "auto" }}>
                                <BillingBadge billing={state.data.billing} />
                            </Box>
                        </Stack>

                        <Paper>
                            {visible.length === 0 ? (
                                <Box sx={{ py: 16, textAlign: "center" }}>
                                    <Typography variant="h3" sx={{ mb: 2 }}>
                                        Nothing here
                                    </Typography>
                                    <Muted>
                                        Change the filter to see the rest of the vocabulary.
                                    </Muted>
                                </Box>
                            ) : (
                                <div className="technique-grid">
                                    {visible.map((technique) => (
                                        <div className="technique" key={technique.name}>
                                            <div className="art">
                                                {technique.url ? (
                                                    <img
                                                        src={bustCache(technique.url, artToken)}
                                                        alt=""
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="none">not drawn</div>
                                                )}
                                            </div>
                                            <div className="cell-title">
                                                {technique.name.replace(/_/g, " ")}
                                            </div>
                                            {technique.category ? (
                                                <Pill>{technique.category}</Pill>
                                            ) : null}
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                disabled={Boolean(busy)}
                                                onClick={() =>
                                                    void draw(
                                                        technique.name,
                                                        [technique.name],
                                                        true
                                                    )
                                                }
                                            >
                                                {busy === technique.name
                                                    ? "Drawing…"
                                                    : technique.url
                                                      ? "Redraw"
                                                      : "Draw"}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Paper>
                    </>
                ) : null}
            </ResourceState>
        </>
    );
}

const DRAWN_STATE = [
    { value: "missing", label: "Not drawn" },
    { value: "drawn", label: "Drawn" },
    { value: "all", label: "All" },
] as const;
