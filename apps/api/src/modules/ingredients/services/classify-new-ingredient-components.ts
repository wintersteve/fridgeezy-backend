import { classifyIngredientComponent } from "@fridgeezy/components";
import { IngredientsRepository } from "@fridgeezy/supabase";

/**
 * Decide whether each newly created ingredient is a dish you make, prep you do,
 * or a product you buy — so a recipe written today offers its components the way
 * one written before it does.
 *
 * ## Why this belongs on the write path
 *
 * Without it the offer decays into a fact about age: the ingredients that
 * existed when the backfill last ran carry a marker and everything since does
 * not. New ingredients arrive with almost every generated dish, so that is not a
 * slow drift — a lasagne written next month would list a béchamel with nothing
 * behind it while the pizza written today links its dough.
 *
 * `operations/classify-ingredient-component.ts` remains the BULK path — for a
 * seeded catalogue, a re-classification after a prompt change, or anything this
 * missed. The two share one prompt (`@fridgeezy/components`) precisely so they
 * cannot disagree about whether soy sauce is something you make.
 *
 * ## It never throws, and never rejects
 *
 * Failure here must not fail the request that created the ingredient. Unlike its
 * dietary twin, an unclassified row here is not merely the safe state — it is
 * INDISTINGUISHABLE from the safe answer, since `bought` and unclassified both
 * draw nothing. So every error is logged and swallowed, and the next bulk run
 * picks the row up.
 */
export async function classifyNewIngredientComponents(
    ingredientIds: string[]
): Promise<void> {
    if (ingredientIds.length === 0) return;

    const ingredientsRepo = new IngredientsRepository();

    try {
        // Re-read rather than trusting the caller's list: the create path
        // returns an existing row when it loses the canonical_id race, and that
        // row may already be classified. This is also what makes the whole thing
        // idempotent, so a retry costs nothing.
        const unclassified = await ingredientsRepo.findUnclassifiedComponents(
            ingredientIds
        );

        if (unclassified.success === false) {
            console.error(
                "[Components] Failed to read unclassified ingredients:",
                unclassified.error
            );
            return;
        }

        const rows = unclassified.value;

        if (rows.length === 0) return;

        const assigned = await classifyIngredientComponent(
            rows.map((row) => row.name),
            {
                onSkip: (message) => console.warn(`[Components] [skip] ${message}`),
            }
        );

        let written = 0;

        for (const row of rows) {
            const component = assigned.get(row.name);

            // No answer means leave it unclassified rather than writing
            // `bought`. The two look identical on screen, but only one of them
            // is picked up again by the next bulk run.
            if (!component) continue;

            const result = await ingredientsRepo.setComponent(
                row.id,
                component.kind,
                component.dish ?? null
            );

            if (result.success === false) {
                console.error(
                    `[Components] Failed to write "${row.name}":`,
                    result.error
                );
                continue;
            }

            written += 1;
        }

        console.log(
            `[Components] Classified ${written}/${rows.length} new ingredient(s)`
        );
    } catch (error) {
        console.error("[Components] Classification failed:", error);
    }
}
