import type { RegenerateImageResponse } from "@fridgeezy/admin-contract";
import { supabaseAdmin } from "@fridgeezy/supabase";
import type { Request, Response } from "express";

import {
    getRecipeImagePublicUrl,
    regenerateRecipeImage,
} from "../../../recipes/services/create-recipe-image";

/**
 * `POST /rest/admin/recipes/:id/image` — paint this dish again.
 *
 * The one route in this module that spends money. Two image generations per
 * press, in fact: the renderer rolls twice and keeps the better-framed one,
 * which is `pickBestFraming`'s trade and not something to undo here.
 *
 * ## It is AWAITED, unlike every other caller
 *
 * On the generation path the render is deliberately unawaited — the URL is
 * predicted from the name, so persistence never has to wait for pixels. Here
 * the whole request IS the render: the curator is looking at the old picture
 * and wants to know whether the new one is better. Lambda's timeout is 300s and
 * a double roll lands well inside it.
 *
 * ## The URL does not change, and that is deliberate
 *
 * The storage path is derived from the dish's name, so a regenerated picture
 * replaces the object under the same URL. Nothing is written to
 * `recipes.image`. A cache-busting query parameter was considered and rejected:
 * `uploadVariants` files the thumbhash with `.eq("image", <canonical url>)`, so
 * a versioned URL in that column would silently stop matching and every future
 * render would fail to attach a hash. **The console cache-busts its own `<img>`
 * instead**, which is the only place that has to see the change immediately.
 *
 * What the app sees depends on the stack: hosted Supabase serves these objects
 * `no-cache` regardless of the `cacheControl` on the upload, so a device
 * revalidates and picks the new picture up. The LOCAL stack honours the
 * year-long max-age, which is why art replaced there stays stale until the
 * client's dev menu drops its image cache. Both are recorded on
 * `uploadVariants`; neither is something this route can fix.
 *
 * ## Why the hash is written here rather than left to the renderer
 *
 * `uploadVariants` already writes it by URL, which covers every row pointing at
 * this picture — a dish and its variants share one. This route writes it again
 * against the same set and reports the count, because the console needs a
 * number to show and because the renderer's write is fire-and-forget by design:
 * a failed hash must not fail an upload that worked. Here it is the one thing
 * the curator is waiting on.
 */
export async function regenerateImage(req: Request, res: Response): Promise<void> {
    const { data: recipe, error: lookupError } = await supabaseAdmin
        .from("recipes")
        .select("id, name")
        .eq("id", req.params.id)
        .maybeSingle();

    if (lookupError) {
        console.error("[admin] regenerateImage lookup failed", lookupError);
        res.status(500).json({ error: "Could not read recipe" });
        return;
    }

    if (!recipe) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    // The prompt is shaped by what the dish contains — `buildRecipeImagePrompt`
    // carries the two failures that earned that. Read fresh rather than taken
    // from the client, so an edit made a moment ago is reflected in the art.
    const { data: ingredientRows } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("ingredients(name)")
        .eq("recipe_id", recipe.id);

    const ingredients = (ingredientRows ?? [])
        .map((row) => row.ingredients?.name)
        .filter((name): name is string => Boolean(name));

    console.log(
        `[admin] ${req.adminProfileId} regenerating image for ${recipe.name} (${recipe.id})`
    );

    const image = await regenerateRecipeImage(
        recipe.name,
        ingredients.length ? ingredients : undefined
    );

    // The renderer reports a failed generation as an empty URL rather than
    // throwing — it is normally a background task with nobody waiting. Here
    // somebody is, so it becomes a real error.
    if (!image.url) {
        res.status(502).json({ error: "The image could not be generated" });
        return;
    }

    const canonicalUrl = getRecipeImagePublicUrl(recipe.name);

    // Keyed on the URL, not the id: a dish and its variants share one picture,
    // and every row pointing at it should carry the new blur. The dish itself
    // is added unconditionally, which is what repairs a row whose `image` was
    // never written — the case a rename leaves behind.
    //
    // Resolved to a list of ids first rather than filtered with `.or()`. That
    // operator's arguments are comma-separated and parenthesised, and this URL
    // contains `:` `/` and `.`; a value that has to be escaped into a filter
    // grammar is a value to keep out of one.
    const { data: siblings } = await supabaseAdmin
        .from("recipes")
        .select("id")
        .eq("image", canonicalUrl);

    const ids = [
        ...new Set([recipe.id, ...(siblings ?? []).map((row) => row.id)]),
    ];

    const { data: updated, error: updateError } = await supabaseAdmin
        .from("recipes")
        .update({ image: canonicalUrl, thumbhash: image.thumbhash ?? null })
        .in("id", ids)
        .select("id");

    if (updateError) {
        // The picture IS written — reporting a failure here would have the
        // curator press again and pay for another pair of renders. Said as a
        // success with a count of zero, and logged where it can be acted on.
        console.error("[admin] regenerateImage could not repoint rows", updateError);
    }

    const body: RegenerateImageResponse = {
        url: canonicalUrl,
        thumbhash: image.thumbhash ?? null,
        recipesUpdated: updated?.length ?? 0,
    };

    res.json(body);
}
