import { classifyIngredientDiet } from "@fridgeezy/dietary";
import { IngredientsRepository } from "@fridgeezy/supabase";

/**
 * Give newly created ingredients their dietary properties, so a dish becomes
 * filterable the moment it exists rather than when someone next remembers to
 * run the backfill.
 *
 * ## Why this has to happen on the write path
 *
 * An unclassified ingredient makes every recipe using it UNKNOWN for dietary
 * purposes, and unknown is excluded from every dietary filter — deliberately,
 * since the alternative is telling someone a dish is nut-free when nobody has
 * checked. That is the right default and a bad steady state: one new ingredient
 * silently withdraws its dish from the vegan, gluten-free and allergen filters,
 * and from `recipe_display_tags`, which is what the cards and the recipe screen
 * draw their dietary chips from. Nothing reports it. The catalogue just quietly
 * stops answering.
 *
 * `operations/classify-ingredient-diet.ts` remains the BULK path — for a seeded
 * catalogue, a re-classification after a prompt change, or anything this missed.
 * The two share one prompt (`@fridgeezy/dietary`) precisely so they cannot
 * disagree about what "gluten" means.
 *
 * ## It never throws, and never rejects
 *
 * Failure here must not fail the request that created the ingredient: the row
 * is already written and useful, and an unclassified row is the SAFE state, not
 * a corrupt one — it under-reports rather than making a false claim. So every
 * error is logged and swallowed, and the next bulk run picks the row up.
 *
 * Only rows with no answer at all are skipped. An ingredient the model returns
 * with an EMPTY property list is a real answer — "carries none of them" — and is
 * written as such, because that is what lets a dish read as vegan.
 */
export async function classifyNewIngredients(
    ingredientIds: string[]
): Promise<void> {
    if (ingredientIds.length === 0) return;

    const ingredientsRepo = new IngredientsRepository();

    try {
        // Re-read rather than trusting the caller's list: the create path
        // returns an existing row when it loses the canonical_id race, and that
        // row may already be classified. This is also what makes the whole thing
        // idempotent, so a retry costs nothing.
        const unclassified = await ingredientsRepo.findUnclassifiedDietary(
            ingredientIds
        );

        if (unclassified.success === false) {
            console.error(
                "[Dietary] Failed to read unclassified ingredients:",
                unclassified.error
            );
            return;
        }

        const rows = unclassified.value;

        if (rows.length === 0) return;

        const assigned = await classifyIngredientDiet(
            rows.map((row) => row.name),
            {
                onSkip: (message) => console.warn(`[Dietary] [skip] ${message}`),
            }
        );

        let written = 0;

        for (const row of rows) {
            const properties = assigned.get(row.name);

            // No answer means leave it unclassified. Writing `[]` here would
            // turn "nobody knows" into "free of everything" — the one mistake
            // this whole path exists to avoid.
            if (!properties) continue;

            const result = await ingredientsRepo.setDietaryProperties(
                row.id,
                properties
            );

            if (result.success === false) {
                console.error(
                    `[Dietary] Failed to write "${row.name}":`,
                    result.error
                );
                continue;
            }

            written += 1;
        }

        console.log(
            `[Dietary] Classified ${written}/${rows.length} new ingredient(s)`
        );
    } catch (error) {
        console.error("[Dietary] Classification failed:", error);
    }
}
