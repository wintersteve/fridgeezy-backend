import { z } from "zod/v4";

import type { ImageBillingPath } from "./common";
import { PageRequestSchema, SortDirectionSchema } from "./common";

/**
 * Per-step cook-mode illustrations, drawn on demand from the console.
 *
 * This is the one thing in the console that spends real money per press, and
 * the amount is not small: ~$0.067 a render against six to twelve steps, so
 * **$0.40-$0.80 for a whole method** — ten times what a dish's hero costs.
 * That is exactly why it is a console screen rather than a deployment flag:
 * `RECIPE_STEP_ART_ENABLED` governs drawing art automatically for EVERY dish
 * the app writes, which is indefensible at that price, while spending it on a
 * handful of chosen dishes is a decision a person makes about a dish.
 *
 * Every shape here carries the cost so the UI cannot show a button without it.
 */

/** What the model charges per step render. Quoted, never silently assumed. */
export const STEP_ART_COST_USD = 0.067;

/**
 * The gathering page's slot.
 *
 * A method's steps are numbered from 1, so the string cannot collide with one,
 * and it is the sentinel `generate-step-art.ts` and `create-step-art.ts`
 * already share. One object key, one meaning, across all three callers.
 */
export const MISE_SLOT = "mise" as const;

export type StepArtSlot = number | typeof MISE_SLOT;

export interface AdminStepArt {
    /** A step number, or `"mise"` for the gathering page. */
    slot: StepArtSlot;
    title: string | null;
    /**
     * The step's sentence. For the gathering page this is the ingredient list
     * it will be drawn from — there is no instruction, because mise is not a
     * step: it has no `recipe_instructions` row and no number.
     */
    instructionText: string;
    /** The public URL, or null when nothing has been drawn for this slot. */
    url: string | null;
}

export interface AdminStepArtState {
    /** Which Google budget a press here spends. */
    billing: ImageBillingPath;
    recipeId: string;
    dish: string;
    /** The gathering page first, then the method in order. */
    steps: AdminStepArt[];
    /** Slots with no picture — what "Draw missing" would cost. */
    missing: number;
}

export const AdminStepArtFilterSchema = PageRequestSchema.extend({
    query: z.string().trim().max(200).optional(),
    /**
     * Whether the dish has ANY step art at all.
     *
     * Three values, not four — there is deliberately no "partly drawn" filter.
     * Answering it would mean counting objects inside every recipe's folder
     * before paging, which is one storage listing PER RECIPE across the whole
     * catalogue. "Has none" and "has some" are both answerable from a single
     * listing of the bucket root, because the root's entries ARE the recipe ids
     * that have at least one picture.
     *
     * The precise "3 of 8" is still shown on the rows, since by then the set is
     * one page and only the rows that have art need looking up.
     */
    art: z.enum(["any", "none", "some"]).default("any"),
    sort: z.enum(["createdAt", "name"]).default("createdAt"),
    dir: SortDirectionSchema.default("desc"),
});

export type AdminStepArtFilter = z.infer<typeof AdminStepArtFilterSchema>;

/** One row in the step-art browser. */
export interface AdminStepArtRow {
    id: string;
    name: string;
    /** The dish's hero, for recognising it — not step art. */
    image: string | null;
    stepCount: number;
    /** Steps with a picture. 0 is the overwhelmingly common case. */
    drawnCount: number;
}

export const DrawStepArtSchema = z.object({
    /**
     * Which slots to draw. Omitted means every slot that has no picture.
     *
     * Named explicitly rather than inferred from `force`, because "redraw step
     * 7" and "draw the four that are missing" are different presses with very
     * different prices, and a caller should have to say which. `"mise"` is a
     * slot here like any number — 61 rather than 60 because a 60-step method
     * has a gathering page as well.
     */
    slots: z
        .array(z.union([z.number().int().min(1).max(60), z.literal(MISE_SLOT)]))
        .max(61)
        .optional(),
    /**
     * Redraw steps that already have a picture.
     *
     * The expensive one. Without it a step that already has art is skipped and
     * reported as such, which is what makes pressing the button twice cost
     * nothing the second time.
     */
    force: z.boolean().default(false),
});

export type DrawStepArtRequest = z.infer<typeof DrawStepArtSchema>;

export interface DrawStepArtResponse {
    dish: string;
    drawn: number;
    failed: number;
    skipped: number;
    /** What this press actually cost, from renders attempted rather than asked for. */
    costUsd: number;
    steps: { slot: StepArtSlot; drawn: boolean; skipped?: boolean }[];
}
