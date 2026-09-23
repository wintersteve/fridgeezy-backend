import {
    RunUpkeepSchema,
    UPKEEP_BATCH_MAX,
    UPKEEP_COST_USD,
    type AdminUpkeepJob,
    type AdminUpkeepState,
    type RunUpkeepResponse,
} from "@fridgeezy/admin-contract";
import { generateEmbedding } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { isPubliclyServed } from "@fridgeezy/toolkit";
import type { Request, Response } from "express";

import { classifyNewIngredientComponents } from "../../../ingredients/services/classify-new-ingredient-components";
import { classifyNewIngredients } from "../../../ingredients/services/classify-new-ingredients";
import {
    generateDishPairings,
    loadSeedDish,
    recordDishPairings,
    resolveDishKey,
} from "../../../recipes/services";
import { parseBody } from "../../services";

/**
 * Catalogue upkeep — the jobs that come back.
 *
 * ## Why these five, out of the fifty scripts next door
 *
 * `apps/database/operations` is mostly ONE-OFFS: a prompt bug is fixed and a
 * backfill repairs the rows written before it, or an art direction moves and a
 * set is re-rendered by hand. A one-off is a script somebody runs once with its
 * header open in front of them, and putting a button on one would be pretending
 * it is routine.
 *
 * A job belongs here when the outstanding work GROWS with ordinary use, nothing
 * fails loudly when it is not done, and it either costs money or wants a person
 * to see what it is about to touch. The contract's own note carries the full
 * test.
 *
 * ## Nothing here is scheduled, and that is the decision rather than an omission
 *
 * `pg_cron` is enabled and already runs one job (`prune_ai_usage_events`,
 * daily). It is the right home for work that is pure SQL and needs no
 * judgement. Every job below either spends money or benefits from somebody
 * seeing which dishes it is about to touch — so each is a press.
 *
 * ## Counting is separate from doing
 *
 * Each job declares how to COUNT what is waiting and how to DO a batch of it,
 * and the console reads the counts before it offers a button. That is what lets
 * a press be priced before it is pressed, which is the rule the step-art and
 * technique screens already follow and the reason neither has a "do everything"
 * control.
 */

/** A dish, as the pairing warmer thinks of one. */
interface ColdDish {
    id: string;
    name: string;
    dishKey: string;
}

/**
 * Catalogue dishes with no pairing set, most-favourited first.
 *
 * Lifted from `operations/warm-dish-pairings.ts` so the console and the script
 * choose the same dishes in the same order. Three rules travel with it:
 *
 * - **Catalogue only** (`created_by is null`). An imported recipe is one
 *   profile's, and a shared pairing set naming it would put its name in a
 *   stranger's picker.
 * - **Base rows only.** A version is somebody's copy of a dish that already has
 *   its own set.
 * - **One entry per DISH, not per row.** A family's copies share a key, so
 *   without the dedupe a dish at three difficulties is warmed three times and
 *   the last two are no-ops that still cost a round trip.
 *
 * Hidden dishes are dropped too, which the script does not do — it predates the
 * column. Warming one would spend a model call on a dish no reader can reach.
 */
async function coldDishes(): Promise<{ cold: ColdDish[]; total: number }> {
    const [warmed, recipes] = await Promise.all([
        supabaseAdmin.from("dish_pairing_sets").select("main_dish_key"),
        supabaseAdmin
            .from("recipes")
            .select("id, name, source_suggestion_id, favourite_count")
            .is("created_by", null)
            .is("base_recipe_id", null)
            .is("hidden_at", null)
            .order("favourite_count", { ascending: false }),
    ]);

    if (warmed.error) throw new Error(warmed.error.message);
    if (recipes.error) throw new Error(recipes.error.message);

    const warm = new Set((warmed.data ?? []).map((row) => row.main_dish_key));

    const dishes = (recipes.data ?? [])
        .map((row) => ({
            id: row.id,
            name: row.name,
            dishKey: row.source_suggestion_id ?? row.id,
        }))
        .filter(
            (dish, index, all) =>
                all.findIndex((other) => other.dishKey === dish.dishKey) === index
        );

    return {
        cold: dishes.filter((dish) => !warm.has(dish.dishKey)),
        total: dishes.length,
    };
}

/**
 * Ingredients nobody has classified, for one of the two classifiers.
 *
 * Most-USED first, because an unclassified ingredient costs in proportion to
 * how many recipes hold it: one unclassified row makes every dish that uses it
 * unknown to the dietary filter, which is a dish quietly excluded rather than a
 * dish shown wrongly.
 */
async function unclassified(
    column: "dietary_properties" | "component_kind",
    limit: number
): Promise<{ rows: { id: string; name: string }[]; outstanding: number; total: number }> {
    const [missing, all] = await Promise.all([
        supabaseAdmin
            .from("ingredients")
            .select("id, name", { count: "exact" })
            .is(column, null)
            .order("use_count", { ascending: false })
            .limit(limit),
        supabaseAdmin.from("ingredients").select("id", { count: "exact", head: true }),
    ]);

    if (missing.error) throw new Error(missing.error.message);

    return {
        rows: missing.data ?? [],
        outstanding: missing.count ?? 0,
        total: all.count ?? 0,
    };
}

/**
 * The tables whose rows carry a vector, and the column each keeps it in.
 *
 * `recipes.fts` is named for what it used to be — a tsvector, before search
 * moved to pgvector — and holds the dish SIGNATURE embedding now.
 *
 * **Every one of these is written on the write path, so a row missing one is a
 * write that FAILED.** `persist-recipe.ts` says so outright: storing the
 * signature is best-effort and "a failure leaves `fts` stale and the row can be
 * re-embedded by the backfill". That is the whole reason this job exists.
 * Nothing reports the failure, and the consequences are expensive and silent —
 * a dish with no signature stops deduping, so the same dinner is generated
 * again and paid for again; a tag with no vector cannot be reached by step 2 of
 * `matchTags`, so a spelling the aliases do not cover widens the vocabulary
 * instead of matching what is already there.
 */
const EMBEDDED = [
    { table: "recipes", column: "fts", label: "recipes" },
    { table: "recipe_suggestions", column: "embedding", label: "suggestions" },
    { table: "tags", column: "embedding", label: "tags" },
    { table: "units", column: "embedding", label: "units" },
] as const;

async function embeddingGaps() {
    return Promise.all(
        EMBEDDED.map(async (target) => {
            const [missing, all] = await Promise.all([
                supabaseAdmin
                    .from(target.table)
                    .select("id, name", { count: "exact" })
                    .is(target.column, null)
                    .limit(UPKEEP_BATCH_MAX.embeddings),
                supabaseAdmin
                    .from(target.table)
                    .select("id", { count: "exact", head: true }),
            ]);

            return {
                ...target,
                rows: (missing.data ?? []) as { id: string; name: string }[],
                outstanding: missing.count ?? 0,
                total: all.count ?? 0,
            };
        })
    );
}

/**
 * Recipes whose stored image URL points at a host no reader can reach.
 *
 * The same predicate `listRecipes`' `unreachableImage` filter uses, and the
 * repair that filter has never had. Found in production on 2026-09-23: 49 of 54
 * recipes carried a developer's LAN address, so every share preview on the
 * internet had been broken for as long as the rows existed.
 *
 * **On a local stack a private host is CORRECT**, so this reports nothing to do
 * rather than offering to rewrite every row to a URL that would then be wrong.
 */
async function unreachableImages(limit: number) {
    const url = process.env.SUPABASE_URL;

    if (!url || !isPubliclyServed(url)) {
        return { rows: [], outstanding: 0, total: 0, origin: null };
    }

    const origin = new URL(url).origin;

    const [broken, all] = await Promise.all([
        supabaseAdmin
            .from("recipes")
            .select("id, name, image", { count: "exact" })
            .not("image", "is", null)
            .not("image", "like", `${origin}%`)
            .limit(limit),
        supabaseAdmin.from("recipes").select("id", { count: "exact", head: true }),
    ]);

    if (broken.error) throw new Error(broken.error.message);

    return {
        rows: (broken.data ?? []) as { id: string; name: string; image: string }[],
        outstanding: broken.count ?? 0,
        total: all.count ?? 0,
        origin,
    };
}

/** How many names to show as "what this press would touch". */
const PREVIEW = 6;

/**
 * `GET /rest/admin/upkeep` — what is waiting, per job.
 *
 * Counts only; nothing here spends anything. The screen can therefore be opened
 * to find out there is nothing to do, which is the state it should be in most
 * days — and the reason every figure is reported even when it is zero. A job
 * that vanished when it was done would make an empty screen indistinguishable
 * from a broken one.
 */
export async function getUpkeep(_req: Request, res: Response): Promise<void> {
    try {
        const [pairings, dietary, components, embeddings, images] = await Promise.all([
            coldDishes(),
            unclassified("dietary_properties", PREVIEW),
            unclassified("component_kind", PREVIEW),
            embeddingGaps(),
            unreachableImages(PREVIEW),
        ]);

        const jobs: AdminUpkeepJob[] = [
            {
                job: "pairings",
                outstanding: pairings.cold.length,
                total: pairings.total,
                next: pairings.cold.slice(0, PREVIEW).map((dish) => dish.name),
            },
            {
                job: "dietary",
                outstanding: dietary.outstanding,
                total: dietary.total,
                next: dietary.rows.map((row) => row.name),
            },
            {
                job: "components",
                outstanding: components.outstanding,
                total: components.total,
                next: components.rows.map((row) => row.name),
            },
            {
                job: "embeddings",
                outstanding: embeddings.reduce((sum, row) => sum + row.outstanding, 0),
                total: embeddings.reduce((sum, row) => sum + row.total, 0),
                // Named by TABLE rather than by row: "240 in tags" is the thing
                // a reader can act on, where three tag names out of 240 is not.
                next: embeddings
                    .filter((row) => row.outstanding > 0)
                    .map((row) => `${row.outstanding} in ${row.label}`),
            },
            {
                job: "imageUrls",
                outstanding: images.outstanding,
                total: images.total,
                next: images.rows.map((row) => row.name),
            },
        ];

        const state: AdminUpkeepState = { jobs, canWarmPairings: true };

        res.json(state);
    } catch (cause) {
        console.error("[admin] getUpkeep failed", cause);
        res.status(500).json({ error: "Could not read upkeep state" });
    }
}

/**
 * `POST /rest/admin/upkeep/run` — do a batch of one job.
 *
 * One route rather than five, because the shape is identical every time: take a
 * job and a size, do that much, report what was done and what is left. Five
 * routes would be five places for the clamp and the error accounting to drift.
 */
export async function runUpkeep(req: Request, res: Response): Promise<void> {
    const body = parseBody(RunUpkeepSchema, req, res);

    if (!body) return;

    // Clamped rather than refused: the console offers a batch it can price, and
    // a hand-written number over the ceiling is a request to time out rather
    // than a request for more.
    const limit = Math.min(body.limit, UPKEEP_BATCH_MAX[body.job]);
    const errors: { subject: string; error: string }[] = [];
    let done = 0;

    try {
        if (body.job === "pairings") {
            const { cold } = await coldDishes();

            // Sequential, unlike the classifiers below. Each dish is a model
            // call plus a fan-out of `persistOrReuseSuggestion`, and those
            // dedupe against each other — running two dishes at once would have
            // them judging siblings the other has not written yet.
            for (const dish of cold.slice(0, limit)) {
                try {
                    const seed = await loadSeedDish(dish.id, req);

                    if (seed.error) throw new Error(String(seed.error.body.error));

                    const mainDishKey = await resolveDishKey(seed.seed.id);

                    // Generating and RECORDING are two calls, which is the one
                    // thing to get right here: `generateDishPairings` returns a
                    // set and writes nothing. Calling it alone spends a model
                    // call and throws the answer away — a warm run that reports
                    // success and leaves every dish exactly as cold as it found
                    // it. Caught during this build precisely because the
                    // outstanding count did not move.
                    const set = await generateDishPairings(seed.seed, {
                        mainDishKey,
                        // Untargeted, the shape a FIRST call takes: these
                        // dishes have no set at all, so the model chooses which
                        // courses the dish wants rather than being handed one.
                        chooseCourses: true,
                    });

                    // Written even when it holds nothing. An empty answer is a
                    // real one — "this dish is eaten on its own" — and
                    // recording WHICH COURSES WERE ASKED is what stops the next
                    // press paying to be told the same thing.
                    const stored = await recordDishPairings({
                        mainDishKey,
                        courses: set.courses,
                        asked: set.asked,
                        pairings: set.pairings,
                        model: set.model,
                    });

                    if (!stored) throw new Error("Generated but could not record");

                    done += 1;
                } catch (cause) {
                    errors.push({
                        subject: dish.name,
                        error: cause instanceof Error ? cause.message : String(cause),
                    });
                }
            }
        }

        if (body.job === "dietary" || body.job === "components") {
            const column =
                body.job === "dietary" ? "dietary_properties" : "component_kind";
            const before = await unclassified(column, limit);
            const classify =
                body.job === "dietary"
                    ? classifyNewIngredients
                    : classifyNewIngredientComponents;

            // Both classifiers take a LIST and send ONE completion for it, and
            // both re-read the rows themselves — so they are idempotent and a
            // repeat press costs one call rather than one per row.
            await classify(before.rows.map((row) => row.id));

            // Counted by re-reading rather than by trusting the call. Neither
            // classifier throws or reports, by design: an unclassified row is
            // the SAFE state, so a failure there must not fail the request that
            // created the ingredient. The difference in the outstanding count
            // is therefore the only honest number, and it is also how a model
            // that quietly skipped a row shows up.
            const after = await unclassified(column, 1);

            done = Math.max(before.outstanding - after.outstanding, 0);

            if (done < before.rows.length) {
                errors.push({
                    subject: `${before.rows.length - done} ingredient(s)`,
                    error: "The model returned no answer for these; press again to retry",
                });
            }
        }

        if (body.job === "embeddings") {
            const gaps = await embeddingGaps();

            for (const target of gaps) {
                // Only the NAME-keyed tables are filled here. `recipes` and
                // `recipe_suggestions` embed a dish SIGNATURE — the canonical
                // name, the tags and the ingredient set — and rebuilding that
                // text here would be a second copy of what `persist-recipe`
                // and `persist-suggestion` construct, which is exactly the
                // drift `buildSuggestionSignature` was extracted to prevent.
                // They are counted so the gap is visible and left to
                // `nx run @fridgeezy/database:embed-recipes`, which already
                // imports the real builder.
                if (target.table !== "tags" && target.table !== "units") continue;

                for (const row of target.rows.slice(0, limit - done)) {
                    try {
                        const embedding = await generateEmbedding(row.name);
                        const { error } = await supabaseAdmin
                            .from(target.table)
                            .update({ embedding: JSON.stringify(embedding) })
                            .eq("id", row.id);

                        if (error) throw new Error(error.message);

                        done += 1;
                    } catch (cause) {
                        errors.push({
                            subject: `${target.label}: ${row.name}`,
                            error: cause instanceof Error ? cause.message : String(cause),
                        });
                    }
                }
            }
        }

        if (body.job === "imageUrls") {
            const { rows, origin } = await unreachableImages(limit);

            if (!origin) {
                res.status(400).json({
                    error: "This database is not publicly served, so its image hosts are correct",
                });
                return;
            }

            for (const row of rows) {
                // Only the HOST is rewritten. The key is right — the bytes are
                // in the bucket under exactly this path — which is what makes
                // this a repair rather than a regeneration.
                const path = new URL(row.image).pathname;
                const { error } = await supabaseAdmin
                    .from("recipes")
                    .update({ image: `${origin}${path}` })
                    .eq("id", row.id);

                if (error) {
                    errors.push({ subject: row.name, error: error.message });
                    continue;
                }

                done += 1;
            }
        }

        const after = await getOutstanding(body.job);

        const response: RunUpkeepResponse = {
            job: body.job,
            done,
            failed: errors.length,
            outstanding: after,
            costUsd: done * UPKEEP_COST_USD[body.job],
            errors: errors.slice(0, 5),
        };

        res.json(response);
    } catch (cause) {
        console.error("[admin] runUpkeep failed", cause);
        res.status(500).json({ error: "Upkeep run failed" });
    }
}

/** What is left after a run, so the console can re-price its button. */
async function getOutstanding(job: RunUpkeepResponse["job"]): Promise<number> {
    if (job === "pairings") return (await coldDishes()).cold.length;
    if (job === "dietary") return (await unclassified("dietary_properties", 1)).outstanding;
    if (job === "components") return (await unclassified("component_kind", 1)).outstanding;
    if (job === "imageUrls") return (await unreachableImages(1)).outstanding;

    const gaps = await embeddingGaps();

    return gaps.reduce((sum, row) => sum + row.outstanding, 0);
}
