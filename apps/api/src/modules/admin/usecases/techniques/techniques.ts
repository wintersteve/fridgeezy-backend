import {
    DrawTechniqueArtSchema,
    TECHNIQUE_ART_COST_USD,
    type AdminTechnique,
    type AdminTechniqueState,
    type DrawTechniqueArtResponse,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { getOrGenerateTechniqueArt } from "../../../techniques/services";
import { imageBillingPath, parseBody } from "../../services";

const BUCKET = "technique_art";

/**
 * How many renders run at once.
 *
 * Three, matching `create-step-art.ts` and for the same reason: a burst of
 * twelve concurrent image calls is big enough to hit a provider rate limit, and
 * nothing is gained by finishing a batch a few seconds sooner.
 */
const CONCURRENCY = 3;

/**
 * `GET /rest/admin/techniques` — the whole vocabulary, and which verbs are drawn.
 *
 * Two reads and no per-row lookup: the table is ~148 rows and the bucket is
 * flat (`<action>.webp`), so one listing answers every verb at once. The same
 * shape `recipe-art.ts` and the step-art browser both use.
 *
 * Categories come along because the vocabulary has them and they are the only
 * sensible grouping for 148 verbs — "which knife cuts have no picture" is a
 * question somebody actually has, where "rows 40-60" is not.
 */
export async function listTechniques(_req: Request, res: Response): Promise<void> {
    const [actions, objects] = await Promise.all([
        supabaseAdmin
            .from("cooking_actions")
            .select("name, description, cooking_action_categories(name)")
            .order("name"),
        supabaseAdmin.storage.from(BUCKET).list("", { limit: 1000 }),
    ]);

    if (actions.error) {
        console.error("[admin] listTechniques failed", actions.error);
        res.status(500).json({ error: "Could not list techniques" });
        return;
    }

    if (objects.error) {
        // Reported rather than treated as "nothing is drawn", which would put
        // a $9 price on a button for work that is already done.
        console.error("[admin] could not list technique art", objects.error);
        res.status(502).json({ error: "Could not read technique art storage" });
        return;
    }

    const drawn = new Set((objects.data ?? []).map((object) => object.name));

    const techniques: AdminTechnique[] = (actions.data ?? []).map((action) => ({
        name: action.name,
        description: action.description,
        category: action.cooking_action_categories?.name ?? null,
        url: drawn.has(`${action.name}.webp`)
            ? supabaseAdmin.storage
                  .from(BUCKET)
                  .getPublicUrl(`${action.name}.webp`).data.publicUrl
            : null,
    }));

    const body: AdminTechniqueState = {
        billing: imageBillingPath(),
        techniques,
        total: techniques.length,
        drawn: techniques.filter((technique) => technique.url).length,
        missing: techniques.filter((technique) => !technique.url).length,
    };

    res.json(body);
}

/**
 * `POST /rest/admin/techniques/art` — draw a batch.
 *
 * ## It calls the app's own generator, not a copy of it
 *
 * `getOrGenerateTechniqueArt` owns the prompt, the 4:3 framing, the white-ground
 * correction that makes every plate sit on one backdrop, and the refusal of any
 * verb not in `cooking_actions`. A console that drew these itself would be a
 * second copy of all of it, free to drift — and the drift would show up as two
 * techniques in two styles inside one sheet.
 *
 * ## Bounded per request, on purpose
 *
 * The schema caps the batch because 139 renders is eight minutes and Lambda
 * stops at five. The console presses this repeatedly, which also keeps the
 * spend visible a batch at a time rather than as one number at the end.
 *
 * ## A failure is per-verb and does not stop the batch
 *
 * The generator throws — on a model that answered with text, on a failed
 * upload. One bad verb must not discard eleven paid renders that worked, so
 * each is caught and reported against its own name.
 */
export async function drawTechniqueArt(req: Request, res: Response): Promise<void> {
    const body = parseBody(DrawTechniqueArtSchema, req, res);

    if (!body) return;

    const queue = [...body.actions];
    const results: DrawTechniqueArtResponse["results"] = [];

    const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let action = queue.shift(); action; action = queue.shift()) {
            try {
                const result = await getOrGenerateTechniqueArt(action, {
                    force: body.force,
                });

                if (!result) {
                    // Not in `cooking_actions`. The console draws its list from
                    // that table, so this means the page is stale rather than
                    // that anything is wrong.
                    results.push({
                        action,
                        drawn: false,
                        error: "not a known technique — reload the list",
                    });
                    continue;
                }

                results.push({
                    action,
                    drawn: result.generated,
                    skipped: !result.generated,
                });
            } catch (cause) {
                console.error(`[admin] technique art failed for ${action}`, cause);

                results.push({
                    action,
                    drawn: false,
                    error: cause instanceof Error ? cause.message : "failed",
                });
            }
        }
    });

    await Promise.all(workers);

    const attempted = results.filter((result) => !result.skipped).length;

    const response: DrawTechniqueArtResponse = {
        drawn: results.filter((result) => result.drawn).length,
        failed: results.filter((result) => !result.drawn && !result.skipped).length,
        skipped: results.filter((result) => result.skipped).length,
        costUsd: Number((attempted * TECHNIQUE_ART_COST_USD).toFixed(2)),
        results: results.sort((a, b) => a.action.localeCompare(b.action)),
    };

    const billing = imageBillingPath();

    // The billing path is logged with the spend, the way
    // `generate-step-art.ts` prints it on every run. A line that says what was
    // drawn and not which budget paid for it is the half of the record that
    // cannot be reconstructed afterwards.
    console.warn(
        `[admin] ${req.adminProfileId} drew ${response.drawn} technique painting(s) ` +
            `(~$${response.costUsd}) via ` +
            (billing.vertex ? `Vertex (${billing.project})` : "AI Studio (GOOGLE_API_KEY)")
    );

    res.json(response);
}
