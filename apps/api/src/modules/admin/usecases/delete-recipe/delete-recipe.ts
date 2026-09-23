import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

/**
 * `DELETE /rest/admin/recipes/:id` — remove the row for good.
 *
 * ## Hiding is the ordinary control; this is not
 *
 * Almost every reason to reach for a delete is better served by hiding: it is
 * reversible, it keeps a reader's favourite pointing at something, and it does
 * not cascade. This exists for the case hiding cannot answer — a duplicate, a
 * dish that should never have been written, a test row — and the console asks
 * for the dish's NAME to be typed before it will send one.
 *
 * ## What goes with it
 *
 * `recipe_ingredients`, `recipe_instructions`, `recipe_tags`,
 * `recipe_components` and `recipe_variants` all cascade from `recipes`, so the
 * content goes. So do the rows readers made: a favourite, a collection entry, a
 * shopping list, a menu course. **That is the cascade doing what it was
 * defined to do, and it is why this is the second control rather than the
 * first.**
 *
 * ## A dish with variants is refused
 *
 * `recipe_variants.base_recipe_id` cascades, so deleting a base would take
 * every reader's personal copy of that dish with it — copies they asked for,
 * about a dish they are still allowed to have. Those are not this tool's to
 * destroy as a side effect of catalogue tidying. Hide the base instead: the
 * variants keep working, because a variant is its own row with its own
 * visibility.
 *
 * ## The storage object is left alone
 *
 * The illustration is keyed by NAME, so another recipe of the same name — a
 * variant, a re-promotion, the dish being written again tomorrow — is pointing
 * at the same object. Deleting it here would blank a picture belonging to rows
 * this request never looked at. Orphaned art costs a few hundred kilobytes and
 * is a sweep to write once, not a side effect to take now.
 */
export async function deleteRecipe(req: Request, res: Response): Promise<void> {
    const { data: recipe, error: lookupError } = await supabaseAdmin
        .from("recipes")
        .select("id, name, base_recipe_id")
        .eq("id", req.params.id)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] deleteRecipe lookup failed", lookupError);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!recipe) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const { count: variants } = await supabaseAdmin
        .from("recipe_variants")
        .select("id", { count: "exact", head: true })
        .eq("base_recipe_id", recipe.id);

    if ((variants ?? 0) > 0) {
        res.status(409).json({
            error: `${variants} reader version(s) are based on this dish — hide it instead of deleting it`,
        });
        return;
    }

    const { error } = await supabaseAdmin
        .from("recipes")
        .delete()
        .eq("id", recipe.id);

    if (error) {
        console.error("[admin] deleteRecipe failed", error);
        res.status(500).json({ error: "Could not delete recipe" });
        return;
    }

    console.warn(
        `[admin] ${req.adminProfileId} DELETED recipe ${recipe.id} (${recipe.name})`
    );

    res.json({ deleted: true });
}

/**
 * `DELETE /rest/admin/suggestions/:id` — drop a dish idea.
 *
 * Much lighter than deleting a recipe and for a structural reason: a suggestion
 * has no readers. Nothing can favourite one, plan one or put one on a shopping
 * list — it is a name, a gloss and an ingredient list waiting to be promoted.
 * Its ingredient and tag rows cascade.
 *
 * The one thing it can be attached to is a recipe that was PROMOTED from it,
 * through `recipes.source_suggestion_id` — and that column carries **no
 * foreign key**, verified against the schema rather than assumed. So nothing
 * cascades into `recipes` and nothing is nulled: the promoted recipe keeps a
 * now-dangling id, which is read only as a provenance note and by
 * `pairing_candidates_for_recipe` as a dish key. Deleting a spent suggestion
 * is therefore safe, which is exactly the case the console offers it for —
 * `find_recipes` already suppresses a promoted suggestion, so those rows are
 * dead weight.
 */
export async function deleteSuggestion(req: Request, res: Response): Promise<void> {
    const { data: suggestion, error: lookupError } = await supabaseAdmin
        .from("recipe_suggestions")
        .select("id, name")
        .eq("id", req.params.id)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] deleteSuggestion lookup failed", lookupError);
        res.status(500).json({ error: "Could not read suggestion" });
        return;
    }

    if (!suggestion) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    const { error } = await supabaseAdmin
        .from("recipe_suggestions")
        .delete()
        .eq("id", suggestion.id);

    if (error) {
        console.error("[admin] deleteSuggestion failed", error);
        res.status(500).json({ error: "Could not delete suggestion" });
        return;
    }

    console.warn(
        `[admin] ${req.adminProfileId} DELETED suggestion ${suggestion.id} (${suggestion.name})`
    );

    res.json({ deleted: true });
}
