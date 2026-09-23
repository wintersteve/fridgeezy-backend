import {
    AdminRecipeStepsSchema,
    AdminRecipeUpdateSchema,
} from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import { parseBody } from "../../services";

/**
 * `PATCH /rest/admin/recipes/:id` — edit the prose and the numbers.
 *
 * ## The derived columns are absent from the schema, not stripped here
 *
 * `name_ascii`, `description_ascii` and the rest are GENERATED columns — the
 * database recomputes them from the values written below, so a rename stays
 * findable by its folded twin with nothing here doing anything about it. An
 * update that tried to write one would be refused by Postgres outright.
 *
 * `canonical_id` is the other kind of derived and the dangerous one: it is not
 * generated, it is computed once at write time and then JOINED ON by dedup, the
 * component lookup and every family read. Editing a name therefore leaves it
 * pointing at the old canonical form, which is **correct** — the canonical id
 * is the dish's identity and a spelling correction is not a new dish. Changing
 * it is a merge, which is `merge_recipe`'s job and not an edit box.
 *
 * ## Renaming moves the picture, and it does not move the file
 *
 * The illustration's storage path is derived from the name
 * (`normalizeFileName`), so after a rename the old object still holds the art
 * and the predicted path for the new name holds nothing. `recipes.image` is
 * left alone — it points at a real object that still exists — so the dish keeps
 * its picture and a REGENERATION will write to the new path. The console warns
 * on the rename; this is the note that says why nothing here tries to be
 * clever about it. Moving the object would break every other row pointing at
 * the same picture, which is how variants share art.
 */
export async function updateRecipe(req: Request, res: Response): Promise<void> {
    const update = parseBody(AdminRecipeUpdateSchema, req, res);

    if (!update) return;

    if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
    }

    // Written out rather than looped, so the set of writable columns is
    // readable in one place and a new contract field cannot reach the database
    // without somebody adding it here.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if ("name" in update) patch.name = update.name;
    if ("nameEn" in update) patch.name_en = update.nameEn;
    if ("description" in update) patch.description = update.description;
    if ("shortDescription" in update) patch.short_description = update.shortDescription;
    if ("difficulty" in update) patch.difficulty = update.difficulty;
    if ("servings" in update) patch.servings = update.servings;
    if ("prepTime" in update) patch.prep_time = update.prepTime;
    if ("cookTime" in update) patch.cook_time = update.cookTime;
    if ("totalTimeMinutes" in update) patch.total_time_minutes = update.totalTimeMinutes;
    if ("kcal" in update) patch.kcal = update.kcal;
    if ("protein" in update) patch.protein = update.protein;
    if ("carbs" in update) patch.carbs = update.carbs;
    if ("fat" in update) patch.fat = update.fat;
    if ("tips" in update) patch.tips = update.tips;
    if ("identityCuisine" in update) patch.identity_cuisine = update.identityCuisine;

    const { data, error } = await supabaseAdmin
        .from("recipes")
        .update(patch)
        .eq("id", req.params.id)
        .select("id")
        .maybeSingle();

    if (error) {
        console.error("[admin] updateRecipe failed", error);
        res.status(500).json({ error: "Could not update recipe" });
        return;
    }

    if (!data) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    console.log(
        `[admin] ${req.adminProfileId} updated recipe ${req.params.id}: ${Object.keys(update).join(", ")}`
    );

    res.json({ updated: true });
}

/**
 * `PUT /rest/admin/recipes/:id/steps` — replace the method.
 *
 * Wholesale, and the contract's own note says why: `step_number` is a position,
 * so per-row editing makes the caller responsible for renumbering after every
 * insert and delete, and a half-applied renumber is two steps claiming the same
 * position.
 *
 * ## Delete-then-insert, and what that costs
 *
 * There is no transaction here — PostgREST has no multi-statement one — so a
 * failure between the two leaves the recipe with **no steps**. That is the
 * honest risk and it is bounded: the delete only fires after the new rows have
 * been validated, both statements are single-table writes against a primary
 * key, and the recipe is one PUT away from being whole again. An RPC would make
 * it atomic; it would also be a migration and a generated-types round trip for
 * a route one person uses. If this ever edits somebody else's live recipe
 * rather than the shared catalogue, make it atomic first.
 *
 * `cooking_action_id` and `ingredient_refs` are deliberately dropped on a
 * rewrite. Both are derived from the sentence by the generator, and keeping a
 * stale action or a reference to an ingredient the new text does not mention is
 * worse than having none — cook mode marks ingredients by reading the text.
 */
export async function replaceRecipeSteps(
    req: Request,
    res: Response
): Promise<void> {
    const body = parseBody(AdminRecipeStepsSchema, req, res);

    if (!body) return;

    const recipeId = req.params.id;

    const { data: recipe, error: lookupError } = await supabaseAdmin
        .from("recipes")
        .select("id")
        .eq("id", recipeId)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] replaceRecipeSteps lookup failed", lookupError);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!recipe) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const { error: deleteError } = await supabaseAdmin
        .from("recipe_instructions")
        .delete()
        .eq("recipe_id", recipeId);

    if (deleteError) {
        console.error("[admin] replaceRecipeSteps delete failed", deleteError);
        res.status(500).json({ error: "Could not replace steps" });
        return;
    }

    if (body.steps.length > 0) {
        const { error: insertError } = await supabaseAdmin
            .from("recipe_instructions")
            .insert(
                body.steps.map((step, index) => ({
                    recipe_id: recipeId,
                    // Positions are assigned here, from the array, which is the
                    // whole point of replacing wholesale.
                    step_number: index + 1,
                    instruction_text: step.instructionText,
                    title: step.title,
                    duration_seconds: step.durationSeconds,
                    temperature_c: step.temperatureC,
                    equipment: step.equipment,
                    tips: step.tips,
                }))
            );

        if (insertError) {
            console.error("[admin] replaceRecipeSteps insert failed", insertError);
            // Said plainly rather than dressed up: the caller has to know the
            // recipe is now stepless so they can retry rather than navigate away.
            res.status(500).json({
                error: "Steps were cleared but the replacement failed — send them again",
            });
            return;
        }
    }

    console.log(
        `[admin] ${req.adminProfileId} replaced ${body.steps.length} step(s) on recipe ${recipeId}`
    );

    res.json({ updated: true, steps: body.steps.length });
}
