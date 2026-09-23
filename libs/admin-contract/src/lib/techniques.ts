import { z } from "zod/v4";

import type { ImageBillingPath } from "./common";

/**
 * Cooking-technique paintings — the closed set, and what is left to draw.
 *
 * ## Why this is worth a screen at all
 *
 * `cooking_actions` is a curated ~148 rows and the generator refuses anything
 * not in it, so the total this feature can cost across every reader for all
 * time is those 148 images ONCE — about ten dollars. That is exactly why
 * `/rest/techniques/illustrate` is free to any signed-in account.
 *
 * What it is NOT is free to the first reader of each verb: art is drawn on the
 * first request for it, so somebody standing at a hob waits for a render to
 * learn what "deglaze" means. Drawing them here retires that wait permanently,
 * for a bounded and knowable price — which is a far better bargain than step
 * art, where the same argument costs $0.40-$0.80 per dish and never ends.
 */

/** What the model charges per render. The same figure step art quotes. */
export const TECHNIQUE_ART_COST_USD = 0.067;

/**
 * The most that may be drawn in ONE request.
 *
 * A render is ~10s and the service runs them three at a time, so twelve is
 * about forty seconds — comfortably inside Lambda's 300s ceiling with room for
 * a slow one. Drawing all 139 missing in a single call would be eight minutes
 * and would simply time out, so the console presses this repeatedly instead
 * and the spend stays visible a batch at a time.
 */
export const TECHNIQUE_ART_BATCH_MAX = 12;

export interface AdminTechnique {
    name: string;
    description: string | null;
    category: string | null;
    /** The public URL, or null when nothing has been drawn for this verb. */
    url: string | null;
}

export interface AdminTechniqueState {
    /** Which Google budget a press here spends. */
    billing: ImageBillingPath;
    techniques: AdminTechnique[];
    total: number;
    drawn: number;
    missing: number;
}

export const DrawTechniqueArtSchema = z.object({
    /**
     * Which verbs to draw, by `cooking_actions.name`.
     *
     * Named explicitly rather than "draw the next N": the server would then be
     * choosing what to spend money on, and the console could not show the price
     * of a press before it was pressed. The UI picks the batch; this draws
     * exactly what it is given.
     */
    actions: z
        .array(z.string().trim().min(1).max(100))
        .min(1)
        .max(TECHNIQUE_ART_BATCH_MAX),
    /** Redraw a verb that already has a painting. */
    force: z.boolean().default(false),
});

export type DrawTechniqueArtRequest = z.infer<typeof DrawTechniqueArtSchema>;

export interface DrawTechniqueArtResponse {
    drawn: number;
    failed: number;
    skipped: number;
    /** Spent, counted from renders ATTEMPTED — a failure still cost a call. */
    costUsd: number;
    results: { action: string; drawn: boolean; skipped?: boolean; error?: string }[];
}
