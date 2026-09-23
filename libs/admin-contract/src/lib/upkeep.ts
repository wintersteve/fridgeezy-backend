import { z } from "zod/v4";

/**
 * The jobs that come back.
 *
 * ## What earns a place on this screen
 *
 * `apps/database/operations` holds about fifty scripts and nearly all of them
 * are ONE-OFFS: a prompt bug is fixed and a backfill repairs the rows written
 * before it, or an art direction changes and a set is re-rendered by hand. A
 * one-off is a script somebody runs once with the header open in front of
 * them; putting a button on it would be pretending it is routine.
 *
 * A job belongs HERE when all three hold:
 *
 * 1. **The outstanding work grows with ordinary use.** New dishes arrive cold,
 *    new ingredients arrive unclassified. Nothing is broken; the catalogue
 *    simply moved.
 * 2. **Nothing fails loudly when it is not done.** Every one of these degrades
 *    silently — a reader waits, a filter quietly excludes a dish, a dedup
 *    misses and the same dinner is generated twice.
 * 3. **It costs money or wants a person to see the result.** Anything that is
 *    pure SQL and needs no judgement belongs in `pg_cron`, which this project
 *    already runs (`prune_ai_usage_events`, daily), NOT behind a button.
 *
 * The third is what keeps this screen from becoming a list of everything. A
 * button whose press is always the right answer is a job nobody should have to
 * press.
 */

/**
 * What one unit of each job costs, in dollars.
 *
 * Embeddings are `text-embedding-3-small` at $0.02 per million tokens, and a
 * dish signature is a few dozen — so the figure is about a fifty-thousandth of
 * a cent and is reported as zero rather than as a misleading `$0.0000`. The two
 * classifiers are one small chat completion per BATCH rather than per row,
 * which is why they quote a batch price.
 */
export const UPKEEP_COST_USD = {
    pairings: 0.02,
    dietary: 0.01,
    components: 0.01,
    embeddings: 0,
    imageUrls: 0,
} as const;

/**
 * The most one press may do, per job.
 *
 * Every one of these is a Lambda request under a 300s ceiling, and the ceilings
 * differ because the work does: a pairing set is a model call and a persist per
 * DISH (~6s each), where the classifiers send one completion for a whole batch
 * and embeddings are a single fast call per row. Pressing repeatedly is the
 * design — it keeps the spend visible a batch at a time, which is the same
 * argument `TECHNIQUE_ART_BATCH_MAX` records.
 */
export const UPKEEP_BATCH_MAX = {
    pairings: 8,
    dietary: 40,
    components: 40,
    embeddings: 100,
    imageUrls: 500,
} as const;

export const UPKEEP_JOBS = [
    "pairings",
    "dietary",
    "components",
    "embeddings",
    "imageUrls",
] as const;

export type UpkeepJob = (typeof UPKEEP_JOBS)[number];

export interface AdminUpkeepJob {
    job: UpkeepJob;
    /** How many rows are waiting. Zero is the healthy state for all of them. */
    outstanding: number;
    /**
     * The whole population the outstanding count is measured against, so the
     * screen can say "21 of 46" rather than a bare number nobody can size.
     */
    total: number;
    /**
     * A sample of what would be worked on next, in the order the run would
     * take them. Names rather than ids: the point is for a person to recognise
     * the dish before spending on it.
     */
    next: string[];
}

export interface AdminUpkeepState {
    jobs: AdminUpkeepJob[];
    /**
     * True when the API can reach its own pairing route with the caller's
     * token. The pairings job posts to `/rest/recipes/:id/pairings/generate`
     * rather than re-implementing the procedure, so it is the one job that
     * needs the server to be able to call itself.
     */
    canWarmPairings: boolean;
}

export const RunUpkeepSchema = z.object({
    job: z.enum(UPKEEP_JOBS),
    /**
     * How many rows to work on. Clamped server-side to the job's own maximum —
     * the console offers the batch it can price, and a hand-written number
     * larger than the ceiling is a request to time out rather than a request
     * for more.
     */
    limit: z.coerce.number().int().min(1).max(500).default(10),
});

export type RunUpkeepRequest = z.infer<typeof RunUpkeepSchema>;

export interface RunUpkeepResponse {
    job: UpkeepJob;
    /** Rows actually completed. */
    done: number;
    /** Rows attempted and refused, with the first reason. */
    failed: number;
    /** What is left after this run, so the console can re-price the button. */
    outstanding: number;
    costUsd: number;
    /** Named so a failure can be chased rather than just counted. */
    errors: { subject: string; error: string }[];
}
