import { supabaseAdmin } from "@fridgeezy/supabase";
import { ingredientCanonicalId, ingredientRelation } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Collapses the duplicate ingredient rows the identity defects created.
 *
 * DRY RUN unless `CLEANUP_APPLY=true`. The dry run performs no writes at all and
 * prints exactly what the apply would do: every pair, which side wins, how many
 * recipe and suggestion rows get repointed, and every case where something is
 * lost rather than moved.
 *
 * ## Order, and why it is this order
 *
 * 1. **Preflight.** Refuse to run unless `20260823000003` and `20260823000004`
 *    are applied. Merging under the OLD `merge_ingredient` aborts halfway
 *    through the first alias-collision pair (see that migration's header), and
 *    merging before the canonical alias key exists leaves the duplicates
 *    re-creatable the moment the next recipe generates.
 * 2. **Delete the known-bad alias.** `red bell pepper -> Green Bell Pepper` was
 *    learned at runtime by the old single-candidate adjudicator and is simply
 *    wrong. It is deleted, never acted on — acting on it merges two genuinely
 *    different peppers.
 * 3. **Alias collisions, merged with no model.** An ingredient row whose
 *    canonical id is already claimed by an alias pointing elsewhere is a
 *    duplicate BY CONSTRUCTION. No embedding, no LLM, no judgement, no cost.
 *    This is the bulk of the real duplication.
 * 4. **The model pass** — `dedupe-ingredients`, run separately and afterwards,
 *    against the much shorter list this leaves behind. Deliberately NOT invoked
 *    from here: it costs money, it needs its own review, and folding a
 *    stochastic step into a deterministic cleanup makes the whole thing
 *    unrepeatable.
 * 5. **Re-embed.** Printed as the required follow-up, not run: a merged row's
 *    stale vector stays comparable to a name that no longer exists, degrading
 *    matching silently instead of failing. It matters more now than before,
 *    because the resolver reads ten neighbours rather than one.
 *
 * ## Atomicity
 *
 * The merges go through `merge_ingredients_batch`, a single plpgsql call and
 * therefore a single transaction. Either every merge lands or none does; there
 * is no halfway state to diagnose. That is the ONLY reversibility here —
 * `merge_ingredient` deletes rows, so after commit the way back is a backup.
 */

interface Collision {
    duplicate_id: string;
    duplicate_name: string;
    keep_id: string;
    keep_name: string;
    via_alias: string;
    duplicate_uses: number;
}

const BAD_ALIASES = [
    {
        alias: "red bell pepper",
        reason:
            "learned at runtime 2026-07-29 by the old single-candidate adjudicator; " +
            "Red and Green Bell Pepper are different ingredients (ripeness changes sweetness)",
    },
];

async function main() {
    const apply = process.env.CLEANUP_APPLY === "true";
    console.log(
        `\n${apply ? "*** APPLY MODE — THIS WRITES ***" : "DRY RUN — no writes. Set CLEANUP_APPLY=true to apply."}\n`
    );

    // ---- 1. preflight -------------------------------------------------------
    //
    // Blocks APPLY only. The dry run deliberately works against an unmigrated
    // database, because "show me the plan before anything is written" has to
    // include the schema change — otherwise the first irreversible step is a
    // precondition of seeing what the second one would do.
    const preflight = await runPreflight();
    if (!preflight.ok) {
        if (apply) {
            console.error(
                `\nREFUSING TO APPLY:\n${preflight.problems.map((p) => `  - ${p}`).join("\n")}\n`
            );
            process.exit(1);
        }
        console.log("preflight: schema not yet migrated — planning from raw tables");
        preflight.problems.forEach((p) => console.log(`  (apply will require) ${p}`));
        console.log();
    } else {
        console.log("preflight: migrations present, merge_ingredient repaired\n");
    }

    // ---- 2. the known-bad alias --------------------------------------------
    console.log("=== step 1: delete known-bad aliases (never act on them) ===\n");
    for (const bad of BAD_ALIASES) {
        const { data } = await supabaseAdmin
            .from("ingredient_aliases")
            .select("alias, ingredients(name)")
            .eq("alias", bad.alias)
            .maybeSingle();

        if (!data) {
            console.log(`  already absent: "${bad.alias}"`);
            continue;
        }
        const target = (data.ingredients as { name: string } | null)?.name ?? "?";
        console.log(`  DELETE  "${bad.alias}" -> ${target}`);
        console.log(`          ${bad.reason}`);

        if (apply) {
            const { error } = await supabaseAdmin
                .from("ingredient_aliases")
                .delete()
                .eq("alias", bad.alias);
            if (error) throw new Error(`delete alias: ${error.message}`);
            console.log("          deleted.");
        }
    }

    // ---- 3. alias collisions ------------------------------------------------
    console.log("\n=== step 2: alias collisions (deterministic, no model) ===\n");

    const allCollisions = await computeCollisions();

    // The bad alias is deleted in step 1; in a dry run it is still present, so
    // drop its pair here too or the plan would advertise a merge apply won't do.
    const collisions = allCollisions.filter(
        (c) => !BAD_ALIASES.some((b) => b.alias === c.via_alias)
    );

    if (collisions.length === 0) {
        console.log("  none outstanding.\n");
    }

    const plan: Array<{ from: string; into: string }> = [];
    const queuedForReview: string[] = [];
    const surprises: string[] = [];
    let totalRecipeEdges = 0;
    let totalSuggestionEdges = 0;

    // When the review table does not exist yet, the migration's backfill has
    // not run — so simulate it, or the dry run advertises merges that apply
    // will correctly refuse. Sibling-shaped contradictions are the ones it
    // seeds as `pending`.
    const reviewTableExists = preflight.ok;

    // A merge is directional. `duplicate` loses, `keep` wins — but sanity-check
    // that against usage, because collapsing the row 27 recipes point at into
    // the row 2 point at is technically identical and much more alarming to read.
    for (const c of collisions) {
        const relation = ingredientRelation(c.duplicate_name, c.keep_name);

        if (!reviewTableExists && relation === "sibling") {
            queuedForReview.push(`${c.duplicate_name}  vs  ${c.keep_name}`);
            continue;
        }

        const detail = await describeMerge(c);
        totalRecipeEdges += detail.recipeEdges;
        totalSuggestionEdges += detail.suggestionEdges;

        console.log(
            `  ${c.duplicate_name}  ->  ${c.keep_name}   [${relation}]  via alias "${c.via_alias}"`
        );
        console.log(
            `      repoints ${detail.recipeEdges} recipe row(s), ${detail.suggestionEdges} suggestion row(s)` +
                `, ${detail.instructionRefs} instruction ref(s), ${detail.aliases} alias(es)` +
                (detail.blacklist > 0 ? `, ${detail.blacklist} BLACKLIST row(s)` : "")
        );

        if (detail.bothInRecipes > 0 || detail.bothInSuggestions > 0) {
            const msg =
                `${c.duplicate_name} + ${c.keep_name} appear TOGETHER in ` +
                `${detail.bothInRecipes} recipe(s) and ${detail.bothInSuggestions} suggestion(s) — ` +
                (detail.unitMismatch
                    ? `a quantity is DROPPED (units differ)`
                    : `quantities are SUMMED`) +
                (detail.lossDetail.length > 0
                    ? ` — ${detail.lossDetail.join("; ")}`
                    : "");
            console.log(`      ${detail.unitMismatch ? "!!" : "+ "} ${msg}`);
            if (detail.unitMismatch) surprises.push(msg);
        }
        if (detail.keepUses < detail.dupUses) {
            const msg =
                `${c.duplicate_name} (${detail.dupUses} uses) is being merged INTO ` +
                `${c.keep_name} (${detail.keepUses} uses) — the less-used name wins. ` +
                `Direction comes from the alias, which points at ${c.keep_name}.`;
            console.log(`      !! ${msg}`);
            surprises.push(msg);
        }
        if (detail.rescuedMetadata.length > 0) {
            // Informational, not a warning: the repaired merge_ingredient
            // NULL-fills these onto the surviving row. Printed because it is the
            // difference between a merge that keeps the catalogue's curated
            // content and one that quietly bins it, and that is worth seeing.
            console.log(
                `      +  rescues ${detail.rescuedMetadata.join(", ")} onto ${c.keep_name} (it has none)`
            );
        }

        plan.push({ from: c.duplicate_id, into: c.keep_id });
    }

    // ---- 4. summary ---------------------------------------------------------
    console.log(`\n=== plan ===\n`);
    console.log(`  merges                     : ${plan.length}`);
    console.log(`  recipe_ingredients rows    : ${totalRecipeEdges} repointed`);
    console.log(`  recipe_suggestion rows     : ${totalSuggestionEdges} repointed`);
    console.log(`  ingredient rows deleted    : ${plan.length}`);
    console.log(`  bad aliases deleted        : ${BAD_ALIASES.length}`);

    const { count: pending, error: pendingErr } = await supabaseAdmin
        .from("ingredient_merge_reviews")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
    console.log(
        `  left for human review      : ${
            pendingErr
                ? `${queuedForReview.length} (the migration's backfill will seed these)`
                : `${pending ?? 0} pending pair(s)`
        }`
    );

    if (queuedForReview.length > 0) {
        console.log(
            `\n  --- held back for review, NOT merged (sibling-shaped) ---`
        );
        queuedForReview.forEach((q) => console.log(`      ${q}`));
    }

    if (surprises.length > 0) {
        console.log(`\n=== ${surprises.length} thing(s) worth a second look ===\n`);
        surprises.forEach((s) => console.log(`  - ${s}`));
    }

    if (!apply) {
        console.log(
            "\nDRY RUN complete. Nothing was written.\n" +
                "To apply:  CLEANUP_APPLY=true npx nx run @fridgeezy/database:cleanup-ingredient-duplicates\n" +
                "Then:      npx nx run @fridgeezy/database:embed-ingredients\n"
        );
        return;
    }

    // ---- 5. apply, as ONE transaction --------------------------------------
    console.log("\napplying as a single transaction...\n");
    const { data: result, error: mergeErr } = await supabaseAdmin.rpc(
        "merge_ingredients_batch",
        { p_pairs: plan }
    );
    if (mergeErr) {
        console.error(
            `\nMERGE FAILED — the transaction rolled back, nothing changed:\n  ${mergeErr.message}\n`
        );
        process.exit(1);
    }
    console.log("  ", JSON.stringify(result));

    const { data: after } = await supabaseAdmin
        .from("ingredient_alias_collisions")
        .select("*", { count: "exact", head: true });
    console.log(`\n  collisions remaining: ${(after as unknown as number) ?? 0}`);
    console.log(
        "\nDONE. Now run:  npx nx run @fridgeezy/database:embed-ingredients\n" +
            "A merged row's stale vector stays comparable to a name that no longer\n" +
            "exists, which degrades matching silently rather than failing.\n"
    );
}

/**
 * The collision set, computed from raw tables rather than read from the view.
 *
 * Same rule as `ingredient_alias_collisions`: an ingredient row whose canonical
 * id is already claimed by an alias pointing at a DIFFERENT row is a duplicate
 * by construction. Computed here so the dry run works before the migration that
 * creates the view — see the preflight note.
 *
 * Sticky `distinct` verdicts are honoured when the review table exists, so a
 * pair a human has already ruled on never reappears in a plan.
 */
async function computeCollisions(): Promise<Collision[]> {
    const pageSize = 500;

    const ingredients: Array<{ id: string; name: string; canonical_id: string }> = [];
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, name, canonical_id")
            .order("id")
            .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`load ingredients: ${error.message}`);
        if (!data || data.length === 0) break;
        ingredients.push(...data);
        if (data.length < pageSize) break;
    }

    const aliases: Array<{ alias: string; ingredient_id: string }> = [];
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin
            .from("ingredient_aliases")
            .select("alias, ingredient_id")
            .order("id")
            .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`load aliases: ${error.message}`);
        if (!data || data.length === 0) break;
        aliases.push(...data);
        if (data.length < pageSize) break;
    }

    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const byCanonical = new Map(ingredients.map((i) => [i.canonical_id, i]));

    // Verdicts, when the table exists. Absent pre-migration, which is fine —
    // nothing has been decided yet either.
    //
    // Held back = any review row NOT ruled 'merged'. A pending sibling
    // contradiction is exactly what a person is supposed to decide, so merging
    // it would answer the question the queue exists to ask. Mirrors the guard
    // in `merge_ingredients_batch`, which is the one that actually enforces it.
    const heldBack = new Set<string>();
    const { data: reviews } = await supabaseAdmin
        .from("ingredient_merge_reviews")
        .select("ingredient_a, ingredient_b, status")
        .neq("status", "merged");
    for (const review of reviews ?? []) {
        heldBack.add(`${review.ingredient_a}|${review.ingredient_b}`);
    }
    const isHeldBack = (a: string, b: string) =>
        heldBack.has(a < b ? `${a}|${b}` : `${b}|${a}`);

    const out: Collision[] = [];
    const seen = new Set<string>();

    for (const alias of aliases) {
        const canonical = ingredientCanonicalId(alias.alias);
        const duplicate = byCanonical.get(canonical);
        const keep = byId.get(alias.ingredient_id);
        if (!duplicate || !keep || duplicate.id === keep.id) continue;
        if (isHeldBack(duplicate.id, keep.id)) continue;

        const key = `${duplicate.id}|${keep.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
            duplicate_id: duplicate.id,
            duplicate_name: duplicate.name,
            keep_id: keep.id,
            keep_name: keep.name,
            via_alias: alias.alias,
            duplicate_uses: 0,
        });
    }

    return out;
}

/** Refuses to proceed unless the schema is in the state the plan assumes. */
async function runPreflight(): Promise<{ ok: boolean; problems: string[] }> {
    const problems: string[] = [];

    const { error: aliasErr } = await supabaseAdmin
        .from("ingredient_aliases")
        .select("alias_canonical_id")
        .limit(1);
    if (aliasErr) {
        problems.push(
            "ingredient_aliases.alias_canonical_id missing — apply 20260823000003 first"
        );
    }

    const { error: reviewErr } = await supabaseAdmin
        .from("ingredient_merge_reviews")
        .select("id")
        .limit(1);
    if (reviewErr) {
        problems.push(
            "ingredient_merge_reviews missing — apply 20260823000004 first"
        );
    }

    // The batch function is only in 20260823000004, and its presence is also
    // what proves the repaired merge_ingredient is installed. Probing with an
    // empty array is a real call that writes nothing.
    const { error: batchErr } = await supabaseAdmin.rpc(
        "merge_ingredients_batch",
        { p_pairs: [] }
    );
    if (batchErr) {
        problems.push(
            `merge_ingredients_batch unavailable (${batchErr.message}) — apply 20260823000004; ` +
                "the UNREPAIRED merge_ingredient aborts on the first alias-collision pair"
        );
    }

    return { ok: problems.length === 0, problems };
}

/** Everything the merge would move or destroy, counted before anything happens. */
async function describeMerge(c: Collision) {
    // The table name is a runtime string here, so the generated per-table types
    // cannot narrow it. Cast at the seam rather than writing four near-identical
    // typed helpers.
    const count = async (
        table: string,
        column: string,
        id: string
    ): Promise<number> => {
        const { count: n } = await (
            supabaseAdmin.from(table as never) as unknown as {
                select: (
                    columns: string,
                    options: { count: "exact"; head: true }
                ) => { eq: (col: string, val: string) => Promise<{ count: number | null }> };
            }
        )
            .select("*", { count: "exact", head: true })
            .eq(column, id);
        return n ?? 0;
    };

    const [recipeEdges, suggestionEdges, aliases, blacklist] = await Promise.all([
        count("recipe_ingredients", "ingredient_id", c.duplicate_id),
        count("recipe_suggestion_ingredients", "ingredient_id", c.duplicate_id),
        count("ingredient_aliases", "ingredient_id", c.duplicate_id),
        count("profile_blacklisted_ingredients", "ingredient_id", c.duplicate_id),
    ]);

    const [keepRecipe, keepSuggestion] = await Promise.all([
        count("recipe_ingredients", "ingredient_id", c.keep_id),
        count("recipe_suggestion_ingredients", "ingredient_id", c.keep_id),
    ]);

    // Recipes/suggestions holding BOTH: the duplicate's row is dropped, not summed.
    const { data: dupRecipes } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("recipe_id")
        .eq("ingredient_id", c.duplicate_id);
    const { data: keepRecipes } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("recipe_id")
        .eq("ingredient_id", c.keep_id);
    const keepRecipeIds = new Set((keepRecipes ?? []).map((r) => r.recipe_id));
    const overlappingRecipeIds = (dupRecipes ?? [])
        .map((r) => r.recipe_id)
        .filter((id) => keepRecipeIds.has(id));
    const bothInRecipes = overlappingRecipeIds.length;

    // Spell out exactly what is lost, per dish, with the numbers — "one recipe
    // affected" is not enough to judge whether to proceed or fix by hand.
    const lossDetail: string[] = [];
    let unitMismatch = false;
    for (const recipeId of overlappingRecipeIds) {
        const [{ data: dish }, { data: rows }] = await Promise.all([
            supabaseAdmin.from("recipes").select("name").eq("id", recipeId).maybeSingle(),
            supabaseAdmin
                .from("recipe_ingredients")
                .select("ingredient_id, quantity, units(abbreviation)")
                .eq("recipe_id", recipeId)
                .in("ingredient_id", [c.duplicate_id, c.keep_id]),
        ]);
        const rowFor = (id: string) => (rows ?? []).find((r) => r.ingredient_id === id);
        const unitOf = (id: string) =>
            (rowFor(id)?.units as { abbreviation: string } | null)?.abbreviation ?? "";
        const qtyOf = (id: string) => Number(rowFor(id)?.quantity ?? 0);

        const sameUnit =
            unitOf(c.keep_id) !== "" && unitOf(c.keep_id) === unitOf(c.duplicate_id);

        // Same unit is SUMMED by merge_ingredient (20260823000005); only a unit
        // mismatch still drops, because no density table exists to convert with.
        lossDetail.push(
            sameUnit
                ? `"${dish?.name ?? recipeId}" SUMS ${qtyOf(c.keep_id)}${unitOf(c.keep_id)} + ` +
                  `${qtyOf(c.duplicate_id)}${unitOf(c.duplicate_id)} = ` +
                  `${qtyOf(c.keep_id) + qtyOf(c.duplicate_id)}${unitOf(c.keep_id)} ${c.keep_name}`
                : `"${dish?.name ?? recipeId}" keeps ${qtyOf(c.keep_id)}${unitOf(c.keep_id)} ${c.keep_name}, ` +
                  `DROPS ${qtyOf(c.duplicate_id)}${unitOf(c.duplicate_id)} ${c.duplicate_name} (units differ, no conversion)`
        );
        if (!sameUnit) unitMismatch = true;
    }

    const { data: dupSugg } = await supabaseAdmin
        .from("recipe_suggestion_ingredients")
        .select("recipe_suggestion_id")
        .eq("ingredient_id", c.duplicate_id);
    const { data: keepSugg } = await supabaseAdmin
        .from("recipe_suggestion_ingredients")
        .select("recipe_suggestion_id")
        .eq("ingredient_id", c.keep_id);
    const keepSuggIds = new Set(
        (keepSugg ?? []).map((s) => s.recipe_suggestion_id)
    );
    const bothInSuggestions = (dupSugg ?? []).filter((s) =>
        keepSuggIds.has(s.recipe_suggestion_id)
    ).length;

    const { data: instructionRows } = await supabaseAdmin
        .from("recipe_instructions")
        .select("id")
        .contains("ingredient_refs", [c.duplicate_id]);

    // Descriptive columns live only on the row being deleted. The repaired
    // merge_ingredient NULL-fills them onto the survivor, so what matters is
    // which fields the survivor is MISSING and the duplicate supplies.
    const cols = "description, nutritional_info, storage_tips, shelf_life, image_url";
    const [{ data: dupRow }, { data: keepRow }] = await Promise.all([
        supabaseAdmin.from("ingredients").select(cols).eq("id", c.duplicate_id).maybeSingle(),
        supabaseAdmin.from("ingredients").select(cols).eq("id", c.keep_id).maybeSingle(),
    ]);

    const rescuedMetadata: string[] = [];
    if (dupRow?.description && !keepRow?.description) rescuedMetadata.push("a description");
    if (dupRow?.nutritional_info && !keepRow?.nutritional_info) rescuedMetadata.push("nutritional_info");
    if ((dupRow?.storage_tips || dupRow?.shelf_life) && !(keepRow?.storage_tips || keepRow?.shelf_life)) {
        rescuedMetadata.push("storage/shelf-life");
    }
    if (dupRow?.image_url && !keepRow?.image_url) rescuedMetadata.push("an image_url");

    return {
        recipeEdges,
        suggestionEdges,
        aliases,
        blacklist,
        instructionRefs: (instructionRows ?? []).length,
        dupUses: recipeEdges + suggestionEdges,
        keepUses: keepRecipe + keepSuggestion,
        bothInRecipes,
        bothInSuggestions,
        lossDetail,
        unitMismatch,
        rescuedMetadata,
    };
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
