import {
    AdminStepArtFilterSchema,
    DrawStepArtSchema,
    MISE_SLOT,
    STEP_ART_COST_USD,
    type AdminStepArtRow,
    type AdminStepArtState,
    type DrawStepArtResponse,
    type StepArtSlot,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import {
    recipeStepArtPublicUrl,
    renderRecipeStepArt,
} from "../../../recipes/services/create-step-art";
import {
    imageBillingPath,
    likeTerm,
    parseBody,
    parseQuery,
    toPage,
} from "../../services";

const BUCKET = "recipe_step_art";

/**
 * A NUMBERED step's object, and nothing else.
 *
 * The folder holds more than steps: `seed-step-art` also writes `mise.webp`,
 * the mise-en-place picture, beside `1.webp`-`7.webp`. Counting every object
 * therefore reported "8 of 7 drawn" — a number that cannot be true and that
 * made the completeness column useless on exactly the dishes that had art.
 *
 * Mise art is deliberately neither counted nor drawable here: it is not a step,
 * it has no row in `recipe_instructions`, and `create-step-art.ts` has no
 * notion of it. The command-line operation is where it is made (`--steps=mise`).
 */
const NUMBERED_STEP = /^\d+\.webp$/;

/**
 * Which recipes have ANY step art, from one listing of the bucket root.
 *
 * The keys are `<recipe_id>/<step_number>.webp`, so the root's entries are
 * exactly the recipe ids that have at least one picture — a folder cannot
 * exist in object storage without an object in it. That makes "has none" and
 * "has some" answerable for the WHOLE catalogue in a single request, which is
 * what lets the browser filter on it before paging rather than after.
 *
 * It stays cheap because it is one entry per DRAWN recipe rather than per
 * recipe: five folders against fifty-four dishes today, and step art is
 * expensive enough that it is never going to be most of them.
 *
 * KNOWN AND ACCEPTED: a folder holding ONLY `mise.webp` and no numbered step
 * counts as "has some" here, so such a dish is missing from the "no step
 * illustrations" filter while its rows still read `0 of 7`. Telling the two
 * apart means listing every folder, which is the per-recipe cost this function
 * exists to avoid — and only `--steps=mise` run on its own produces one.
 */
async function fetchRecipesWithArt(): Promise<Set<string>> {
    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { limit: 1000 });

    if (error) {
        console.error("[admin] could not list step art", error);
        // An empty set means "none have art", which would make the `none`
        // filter return everything. Rethrown so the caller reports a failure
        // instead of a confident wrong answer.
        throw new Error("Could not read step art storage");
    }

    return new Set((data ?? []).map((entry) => entry.name));
}

/**
 * `GET /rest/admin/step-art/recipes` — every recipe, and how much of its method
 * is illustrated.
 *
 * ## Why this is a browser and not just the search box it started as
 *
 * Picking a dish by name assumes you already know which one you want. The
 * question this screen actually gets asked is the other way round — "which
 * dishes have no step art" — and that is a filter over the catalogue, not a
 * lookup.
 *
 * ## Two reads, and only one of them scales with the page
 *
 * The bucket root gives every recipe's has-art/has-none state at once, so the
 * FILTER runs server-side and paging stays correct. The exact `3 of 8` needs a
 * listing inside a recipe's own folder — so that is done only for the rows on
 * this page that are in the set at all, which today is almost none of them. A
 * page of fifty undrawn dishes costs zero extra storage calls.
 */
export async function listStepArtRecipes(req: Request, res: Response): Promise<void> {
    const filter = parseQuery(AdminStepArtFilterSchema, req, res);

    if (!filter) return;

    let withArt: Set<string>;

    try {
        withArt = await fetchRecipesWithArt();
    } catch (cause) {
        console.error("[admin] listStepArtRecipes failed", cause);
        res.status(502).json({ error: "Could not read step art storage" });
        return;
    }

    let query = supabaseAdmin
        .from("recipes")
        .select("id, name, image", { count: "exact" });

    if (filter.query) query = query.ilike("name_ascii", likeTerm(filter.query));

    // Hidden dishes are excluded outright rather than offered as a filter:
    // paying $0.40 to illustrate a method nobody can reach is the one mistake
    // this screen should make impossible.
    query = query.is("hidden_at", null);

    const ids = [...withArt];

    if (filter.art === "some") {
        // An empty `in` list is not a no-op in PostgREST, so an empty set has
        // to collapse to a filter that matches nothing.
        query = ids.length ? query.in("id", ids) : query.is("id", null);
    }

    if (filter.art === "none" && ids.length) {
        query = query.not("id", "in", `(${ids.join(",")})`);
    }

    const column = { createdAt: "created_at", name: "name" }[filter.sort];

    const { data, error, count } = await query
        .order(column, { ascending: filter.dir === "asc" })
        .order("id", { ascending: true })
        .range(filter.offset, filter.offset + filter.limit - 1);

    if (error) {
        console.error("[admin] listStepArtRecipes failed", error);
        res.status(500).json({ error: "Could not list recipes" });
        return;
    }

    const recipes = data ?? [];
    const pageIds = recipes.map((recipe) => recipe.id);

    // How many steps each has. One query over the page's ids, counted here —
    // PostgREST has no group-by, and a `head` count per recipe would be fifty
    // requests to fill one column.
    const { data: steps } = pageIds.length
        ? await supabaseAdmin
              .from("recipe_instructions")
              .select("recipe_id")
              .in("recipe_id", pageIds)
        : { data: [] };

    const stepCounts = new Map<string, number>();

    for (const step of steps ?? []) {
        stepCounts.set(step.recipe_id, (stepCounts.get(step.recipe_id) ?? 0) + 1);
    }

    // Only the rows that have art at all. See the note above: this is the read
    // that would not scale if it ran for every row.
    const drawnCounts = new Map<string, number>();

    await Promise.all(
        pageIds
            .filter((id) => withArt.has(id))
            .map(async (id) => {
                const { data: objects } = await supabaseAdmin.storage
                    .from(BUCKET)
                    .list(id, { limit: 1000 });

                drawnCounts.set(
                    id,
                    (objects ?? []).filter((object) => NUMBERED_STEP.test(object.name)).length
                );
            })
    );

    const rows: AdminStepArtRow[] = recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        image: recipe.image,
        stepCount: stepCounts.get(recipe.id) ?? 0,
        drawnCount: drawnCounts.get(recipe.id) ?? 0,
    }));

    res.json(toPage(rows, count, filter));
}

/**
 * `GET /rest/admin/recipes/:id/step-art` — the method, and which steps have a
 * picture.
 *
 * ## Asked of STORAGE, like the hero count
 *
 * There is no column recording that a step was drawn — the bucket is the
 * record, keyed `<recipe_id>/<step_number>.webp`. One listing scoped to this
 * recipe's own prefix answers every step at once, which is the same shape
 * `recipe-art.ts` uses for heroes and for the same reason: a probe per step is
 * a dozen requests to draw one screen.
 *
 * A URL is returned only for a step whose object actually EXISTS. The public
 * URL is derivable for any step at all, so returning it unconditionally would
 * put a broken `<img>` on every undrawn step and make the screen useless for
 * the one question it answers.
 */
export async function getStepArt(req: Request, res: Response): Promise<void> {
    const recipeId = req.params.id;

    const [recipe, steps, objects, ingredients] = await Promise.all([
        supabaseAdmin.from("recipes").select("id, name").eq("id", recipeId).maybeSingle(),
        supabaseAdmin
            .from("recipe_instructions")
            .select("step_number, title, instruction_text")
            .eq("recipe_id", recipeId)
            .order("step_number"),
        supabaseAdmin.storage.from(BUCKET).list(recipeId, { limit: 1000 }),
        supabaseAdmin
            .from("recipe_ingredients")
            .select("ingredients(name)")
            .eq("recipe_id", recipeId),
    ]);

    if (recipe.error) {
        console.error("[admin] getStepArt failed", recipe.error);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!recipe.data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const drawn = new Set((objects.data ?? []).map((object) => object.name));

    const url = (slot: StepArtSlot) =>
        drawn.has(`${slot}.webp`) ? recipeStepArtPublicUrl(recipeId, slot) : null;

    /*
      The gathering page leads, because that is the order a cook meets them —
      the bench before step one — and because this list is what the console
      draws in order.

      It is a FIRST-CLASS slot rather than an extra beside the method: it costs
      the same render, lives in the same bucket under the same key shape, and is
      drawn or missing exactly like a step. What it is not is a step — it has no
      `recipe_instructions` row and no number — so its `instructionText` carries
      the ingredient list it will be drawn from instead of a sentence.
    */
    const ingredientNames = (ingredients.data ?? [])
        .map((row) => row.ingredients?.name)
        .filter((name): name is string => Boolean(name));

    const slots: AdminStepArtState["steps"] = [
        {
            slot: MISE_SLOT,
            title: "Gathering page",
            instructionText: ingredientNames.length
                ? ingredientNames.join(", ")
                : "No ingredients recorded — there is nothing to gather.",
            url: url(MISE_SLOT),
        },
        ...(steps.data ?? []).map((step) => ({
            slot: step.step_number,
            title: step.title,
            instructionText: step.instruction_text,
            url: url(step.step_number),
        })),
    ];

    const body: AdminStepArtState = {
        billing: imageBillingPath(),
        recipeId,
        dish: recipe.data.name,
        steps: slots,
        missing: slots.filter((slot) => !slot.url).length,
    };

    res.json(body);
}

/**
 * `POST /rest/admin/recipes/:id/step-art` — draw them.
 *
 * ## The most expensive route in this API, and the only honest place for it
 *
 * ~$0.067 a render, six to twelve steps a recipe. `renderRecipeStepArt` is
 * reached directly rather than `generateRecipeStepArt`, so
 * `RECIPE_STEP_ART_ENABLED` does NOT apply — see that file's header. The flag
 * governs drawing art automatically for every dish the app writes; this is the
 * manual path, and a console button that silently did nothing because a
 * deployment variable was unset would be worse than no button.
 *
 * ## Awaited, like the hero regeneration and for the same reason
 *
 * The generation path fires this as an untracked background task because
 * nothing is waiting. Here the request IS the job: somebody pressed a button
 * that costs money and needs to know what it bought. Twelve steps at
 * concurrency three is well inside the 300s Lambda timeout.
 *
 * ## The cost reported is what was SPENT, not what was asked for
 *
 * Skipped steps are free and failures are not — a render that failed was still
 * a call. So the figure counts attempts rather than successes, which is the
 * only version of it that cannot understate a bill.
 */
export async function drawStepArt(req: Request, res: Response): Promise<void> {
    const body = parseBody(DrawStepArtSchema, req, res);

    if (!body) return;

    const result = await renderRecipeStepArt(req.params.id, {
        slots: body.slots,
        force: body.force,
    });

    if (!result) {
        // `renderRecipeStepArt` answers null for a missing recipe AND for one
        // with no steps, which is the same thing from here: there is nothing to
        // draw and nothing the caller can do about it on this screen.
        res.status(404).json({ error: "No recipe, or it has no steps" });
        return;
    }

    const attempted = result.results.filter((slot) => !slot.skipped).length;

    const response: DrawStepArtResponse = {
        dish: result.dish,
        drawn: result.results.filter((slot) => slot.drawn).length,
        failed: result.results.filter((slot) => !slot.drawn && !slot.skipped).length,
        skipped: result.results.filter((slot) => slot.skipped).length,
        costUsd: Number((attempted * STEP_ART_COST_USD).toFixed(2)),
        steps: result.results,
    };

    const billing = imageBillingPath();

    // See `techniques.ts`: the budget that paid is part of the record.
    console.warn(
        `[admin] ${req.adminProfileId} drew ${response.drawn} step picture(s) for ` +
            `${result.dish} (~$${response.costUsd}) via ` +
            (billing.vertex ? `Vertex (${billing.project})` : "AI Studio (GOOGLE_API_KEY)")
    );

    res.json(response);
}
