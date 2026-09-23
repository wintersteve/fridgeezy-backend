import {
    UPKEEP_BATCH_MAX,
    UPKEEP_COST_USD,
    type AdminUpkeepJob,
    type AdminUpkeepState,
    type RunUpkeepResponse,
    type UpkeepJob,
} from "@fridgeezy/admin-contract";
import { Muted, Pill, TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";


import { useToast } from "../components/toast";
import { PageHead, ResourceState } from "../components/ui";
import { api } from "../lib/api";
import { useResource } from "../lib/use-resource";

const money = (amount: number) => (amount === 0 ? "free" : `$${amount.toFixed(2)}`);

/**
 * What each job is, and what it costs to leave undone.
 *
 * The second line of each is the one that matters. A console listing five
 * maintenance jobs with no consequences attached is a list of chores; every one
 * of these degrades something a reader can feel, and none of them raises an
 * error when it is skipped — so the screen has to say what goes wrong, or
 * nobody can tell which button is worth pressing today.
 */
const JOBS: Record<UpkeepJob, { title: string; what: string; cost: string }> = {
    pairings: {
        title: "Pairing sets",
        what: "Catalogue dishes nobody has warmed. The first reader to compose a menu around one waits at a spinner for the model; warming it retires that wait for everybody who follows.",
        cost: "per dish",
    },
    dietary: {
        title: "Ingredient diets",
        what: "Ingredients with no dietary properties. Until one is classified, every recipe that uses it has UNKNOWN dietary status and is excluded from every dietary filter — so the dish is quietly missing rather than wrongly shown.",
        cost: "per batch",
    },
    components: {
        title: "Make-or-buy",
        what: "Ingredients nobody has classified as something you make. Until then the recipe screen offers no “make it yourself” line for them, and the dishes that use them are generated rather than found.",
        cost: "per batch",
    },
    embeddings: {
        title: "Missing vectors",
        what: "Rows whose embedding write failed. Every one of these is written on the way in, so a gap is a FAILURE nobody was told about: a dish with no signature stops deduping and is generated again and paid for again, and a tag with no vector cannot be matched by spelling, so the vocabulary widens instead.",
        cost: "negligible",
    },
    imageUrls: {
        title: "Unreachable art",
        what: "Recipes whose stored picture points at a host no reader can reach. The bytes are in the bucket under the right key — only the URL is wrong — so every share preview of one is broken until it is rewritten.",
        cost: "free",
    },
};

/**
 * Catalogue upkeep.
 *
 * ## Why this is one screen and not five
 *
 * Each of these is a handful of rows most weeks and zero on a good one. Five
 * screens would be five places to go and find nothing, and a sidebar entry per
 * job would report a backlog that is almost always empty — the thing
 * `LibrarySummaryCard` was deleted for in the client.
 *
 * ## The counts are drawn even at zero
 *
 * A job that vanished when it was done would make an empty screen
 * indistinguishable from a broken one, and the reason to open this page is
 * usually to confirm there is nothing to do.
 */
export function UpkeepPage() {
    const toast = useToast();
    const [busy, setBusy] = useState<UpkeepJob>();

    const state = useResource(() => api.get<AdminUpkeepState>("/upkeep"), []);

    const run = async (job: AdminUpkeepJob) => {
        const limit = Math.min(job.outstanding, UPKEEP_BATCH_MAX[job.job]);

        setBusy(job.job);

        try {
            const result = await api.post<RunUpkeepResponse>("/upkeep/run", {
                job: job.job,
                limit,
            });

            state.reload();

            const spent = result.costUsd > 0 ? ` Spent ${money(result.costUsd)}.` : "";

            if (result.failed > 0) {
                toast.show(
                    "warn",
                    `${result.done} done, ${result.failed} failed (${result.errors[0]?.error ?? "no reason given"}).${spent}`
                );

                return;
            }

            toast.show(
                "ok",
                `${result.done} done, ${result.outstanding} left.${spent}`
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
                title="Upkeep"
                lede="The jobs that come back as the catalogue is used. Everything here degrades silently — nothing on this page is reported by an error anywhere else, which is why it has a screen. Zero is the healthy state for all of them."
            />

            <ResourceState
                loading={state.loading}
                fetching={state.fetching}
                error={state.error}
            >
                <Stack spacing={4}>
                    {state.data?.jobs.map((job) => {
                        const copy = JOBS[job.job];
                        const batch = Math.min(job.outstanding, UPKEEP_BATCH_MAX[job.job]);
                        const price = batch * UPKEEP_COST_USD[job.job];
                        const clear = job.outstanding === 0;

                        return (
                            <Paper className="pad" key={job.job}>
                                <Stack
                                    direction="row"
                                    spacing={4}
                                    alignItems="flex-start"
                                    flexWrap="wrap"
                                    useFlexGap
                                >
                                    <Box sx={{ flex: 1, minWidth: 320 }}>
                                        <Stack
                                            direction="row"
                                            spacing={2}
                                            alignItems="center"
                                            sx={{ mb: 2 }}
                                        >
                                            <Typography variant="h3">{copy.title}</Typography>
                                            {clear ? (
                                                <Pill tone="live">nothing waiting</Pill>
                                            ) : (
                                                <Pill tone="accent">
                                                    {job.outstanding} of {job.total}
                                                </Pill>
                                            )}
                                        </Stack>
                                        <Typography
                                            variant="body2"
                                            sx={{ color: TOKENS.inkSoft, maxWidth: "70ch" }}
                                        >
                                            {copy.what}
                                        </Typography>
                                        {/* What the next press would touch, by name.
                                            A count alone cannot be sanity-checked;
                                            six dish names can, and this is the one
                                            moment before the money is spent. */}
                                        {job.next.length > 0 ? (
                                            <Box sx={{ mt: 2 }}>
                                                <Muted>Next: {job.next.join(", ")}</Muted>
                                            </Box>
                                        ) : null}
                                    </Box>

                                    <Stack spacing={2} alignItems="flex-end">
                                        <Button
                                            variant="contained"
                                            disabled={clear || Boolean(busy)}
                                            onClick={() => void run(job)}
                                        >
                                            {busy === job.job
                                                ? "Working…"
                                                : clear
                                                  ? "Nothing to do"
                                                  : `Run ${batch} · ${money(price)}`}
                                        </Button>
                                        {clear ? null : (
                                            // The unit price, and only where
                                            // there is one — `money(0)` reads
                                            // "free", so quoting it beside a
                                            // label that also says free came
                                            // out as "free negligible".
                                            <Muted>
                                                {UPKEEP_COST_USD[job.job] === 0
                                                    ? copy.cost
                                                    : `${money(UPKEEP_COST_USD[job.job])} ${copy.cost}`}
                                            </Muted>
                                        )}
                                    </Stack>
                                </Stack>
                            </Paper>
                        );
                    })}
                </Stack>
            </ResourceState>
        </>
    );
}
