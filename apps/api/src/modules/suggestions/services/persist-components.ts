import { supabaseAdmin } from "@fridgeezy/supabase";
import { canonicalizeName, ingredientCanonicalId } from "@fridgeezy/toolkit";

/**
 * Record which COMPONENTS a freshly written dish is built on.
 *
 * The write side of `20260913000003`. It runs after the dish is persisted and is
 * deliberately additive: the ingredient list keeps listing the butter, the flour
 * and the milk, and this says separately that they add up to a béchamel. See the
 * migration header for what each consumer of `recipe_ingredients` does when a
 * component is written as an ingredient row instead.
 *
 * ## A model naming a component does not make it one
 *
 * Two gates, both structural, both the same ones `backfill-recipe-components`
 * applies — because the two write paths must not disagree about what a component
 * claim is worth:
 *
 * 1. **Closed vocabulary.** A name is accepted only when it already matches an
 *    ingredient classified `component_kind = 'dish'`. The model picks from what
 *    the component classifier has vetted; it cannot name a component into being,
 *    and an unrecognised name is dropped in silence rather than creating a row.
 * 2. **No self-reference.** A béchamel is not built on a béchamel. Compared on
 *    canonical id against both the component's own name and its `component_dish`,
 *    since a component answers to both.
 *
 * The third gate the backfill applies — grounding the claim in the dish's own
 * ingredients — is deliberately NOT repeated here. There, the model is being
 * asked about a dish somebody else wrote and has every reason to reach; here it
 * wrote the ingredient list itself one breath earlier, so the list and the claim
 * come from one answer rather than two. Adding a second LLM-free check would
 * still be cheap, and is the obvious place to go if these ever look optimistic.
 *
 * ## Never throws, never blocks
 *
 * A component link is a retrieval nicety. The dish is already written and the
 * card is already promised by the time this runs, so a failure here logs and
 * returns — the same contract `recordTasteSignal` and `recordPrompt` have, for
 * the same reason. `backfill-recipe-components` picks up anything missed.
 */
/**
 * Carry a promoted suggestion's component declarations onto its recipe.
 *
 * Promotion writes a new `recipes` row and then DELETES the suggestion, so
 * without this every component a dish declared as a card is lost the moment it
 * becomes a recipe — and recipes are the half of the catalogue that matters most
 * for retrieval, since a recipe can be opened rather than generated.
 *
 * Runs as background bookkeeping, alongside `markPromotedFrom`, and for the
 * same reasons: the caller already has the recipe id it needs, and this must not
 * sit between the last model token and the completion frame. It is also ordered
 * BEFORE the suggestion is deleted, exactly as `markPromotedFrom` is — the
 * source rows cascade away with it.
 *
 * Skipped for an ADAPTED variant, which takes the `variantBaseId` branch and
 * returns early: that recipe is one caller's adaptation of the dish, its
 * ingredient list was rewritten around a blacklist, and the components the
 * original declared may no longer be in it. The backfill can decide about it
 * later on the evidence, which is the right owner for that question.
 */
export async function copyComponentsToRecipe(
    suggestionId: string,
    recipeId: string
): Promise<void> {
    try {
        const { data, error } = await supabaseAdmin
            .from("recipe_suggestion_components")
            .select("ingredient_id")
            .eq("recipe_suggestion_id", suggestionId);

        if (error || !data?.length) return;

        const { error: writeError } = await supabaseAdmin
            .from("recipe_components")
            .upsert(
                data.map((row) => ({
                    recipe_id: recipeId,
                    ingredient_id: row.ingredient_id as string,
                })) as never
            );

        if (writeError) {
            console.warn(
                `[Components] Could not carry components onto recipe ${recipeId}: ${writeError.message}`
            );
        }
    } catch (error) {
        console.warn(`[Components] Carry-over failed for ${recipeId}:`, error);
    }
}

export async function persistComponents(
    dish: { id: string; name: string; source: "recipe" | "suggestion" },
    componentNames: string[] | undefined
): Promise<void> {
    if (!componentNames?.length) return;

    try {
        const canonical = [
            ...new Set(
                componentNames
                    .map((name) => ingredientCanonicalId(name))
                    .filter(Boolean)
            ),
        ];

        if (canonical.length === 0) return;

        // Gate 1: the closed vocabulary. Matched on both keys, because the model
        // may write either the listing name ("Bechamel Sauce") or the asking one
        // ("Béchamel").
        const { data, error } = await supabaseAdmin
            .from("ingredients")
            .select("id, name, canonical_id, component_dish, component_dish_canonical_id")
            .eq("component_kind", "dish")
            .or(
                `canonical_id.in.(${canonical.join(",")}),component_dish_canonical_id.in.(${canonical.join(",")})`
            );

        if (error) {
            console.warn(
                `[Components] Could not resolve components for "${dish.name}": ${error.message}`
            );

            return;
        }

        const dishCanonical = canonicalizeName(dish.name);

        // Gate 2: a dish is never its own component.
        const accepted = (data ?? []).filter((row) => {
            const self =
                dishCanonical === canonicalizeName(row.name as string) ||
                dishCanonical ===
                    canonicalizeName(row.component_dish as string | null) ||
                dishCanonical === (row.component_dish_canonical_id as string | null);

            return !self;
        });

        const dropped = componentNames.length - accepted.length;

        if (dropped > 0) {
            console.log(
                `[Components] "${dish.name}": ${accepted.length}/${componentNames.length} claim(s) accepted (${dropped} not a classified component, or the dish itself)`
            );
        }

        if (accepted.length === 0) return;

        const rows = accepted.map((row) =>
            dish.source === "recipe"
                ? { recipe_id: dish.id, ingredient_id: row.id as string }
                : {
                      recipe_suggestion_id: dish.id,
                      ingredient_id: row.id as string,
                  }
        );

        const { error: writeError } = await supabaseAdmin
            .from(
                dish.source === "recipe"
                    ? "recipe_components"
                    : "recipe_suggestion_components"
            )
            .upsert(rows as never);

        if (writeError) {
            console.warn(
                `[Components] Could not record components for "${dish.name}": ${writeError.message}`
            );
        }
    } catch (error) {
        console.warn(`[Components] Failed for "${dish.name}":`, error);
    }
}
