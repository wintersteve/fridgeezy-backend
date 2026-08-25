import { RecipesRepository } from "@fridgeezy/supabase";

import {
    fetchRecipeSummary,
    RecipeSummary,
} from "../../recipes/services/fetch-recipe-summary";
import { searchRecipesByEmbedding } from "../../recipes/services/search-recipes";

import { adjudicateSameDish } from "./adjudicate-suggestion";
import { componentsDisagree } from "./component-identity";
import { pickIdentityMatch, sharesCanonicalName } from "./pick-identity-match";
import {
    describeSuggestion,
    SIGNATURE_HIGH_THRESHOLD,
    SIGNATURE_LOW_THRESHOLD,
} from "./suggestion-signature";

export interface DishIdentity {
    name: string;
    nameEn?: string | null;
    tags: string[];
    ingredients: string[];
    /** Identity cuisine; null means unknown, which merges. */
    cuisine?: string | null;
}

/**
 * Find the recipe that already exists for this dish, if any.
 *
 * This is the missing half of suggestion dedup. `persistOrReuseSuggestion` only
 * ever compared a new suggestion against OTHER SUGGESTIONS — but promotion
 * DELETES the suggestion row once the recipe is persisted, so the moment a dish
 * becomes a recipe it disappears from the only table dedup was looking at and is
 * guaranteed to be regenerated forever after.
 *
 * Identity is decided exactly as it is between two suggestions: an exact
 * canonical name match first (cheap, deterministic, cross-checks `name_en` so a
 * native name and its translation collapse), then a signature-similarity search
 * with the same calibrated band — auto-merge above the high threshold, LLM
 * adjudication through the gray zone, distinct below the low one.
 *
 * Fails OPEN: any lookup error returns null (treat the dish as new) rather than
 * blocking a generation on a flaky read.
 *
 * @param dish The dish to look for
 * @param signatureEmbedding The dish signature embedding, already computed by
 *   the caller for suggestion dedup — reused so we never embed the same text
 *   twice, and so both tables are searched with the identical vector.
 */
export async function findRecipeForDish(
    dish: DishIdentity,
    signatureEmbedding: number[],
    recipesRepo: RecipesRepository = new RecipesRepository()
): Promise<RecipeSummary | null> {
    // Layer 1: exact canonical name match (either language) under a compatible
    // cuisine. A name hit alone is no longer identity — see `pickIdentityMatch`.
    const exactResult = await recipesRepo.findBaseRecipes([
        dish.name,
        dish.nameEn,
    ]);

    if (!exactResult.success) {
        console.error(
            `[Suggestions] Recipe name lookup failed for "${dish.name}":`,
            exactResult.error
        );
    } else if (exactResult.value.length > 0) {
        const match = await pickIdentityMatch(
            { name: dish.name, cuisine: dish.cuisine ?? null },
            exactResult.value.map((row) => ({
                row,
                identityCuisine: row.identityCuisine,
                label: row.name,
            }))
        );

        if (match) {
            const summary = await fetchRecipeSummary(match.id);
            if (summary) {
                return summary;
            }
        }
    }

    // Layer 2: signature similarity + adjudication over the gray band.
    const candidates = await searchRecipesByEmbedding(
        signatureEmbedding,
        SIGNATURE_LOW_THRESHOLD,
        5
    );

    for (const candidate of candidates) {
        const summary = await fetchRecipeSummary(candidate.id);
        if (!summary) continue;

        // A building block is never the dish built on it, however close the
        // signatures sit — and they sit very close, because they share nearly
        // every ingredient. Checked BEFORE the score so it overrules auto-merge
        // too: that is the path that folded a generated Ragù into Lasagna.
        if (
            componentsDisagree(
                dish.tags,
                summary.tags.map((tag) => tag.name)
            )
        ) {
            continue;
        }

        const autoMerge = candidate.score >= SIGNATURE_HIGH_THRESHOLD;
        const isSameDish =
            autoMerge ||
            (await adjudicateSameDish(
                describeSuggestion(
                    dish.name,
                    dish.nameEn,
                    dish.tags,
                    dish.ingredients
                ),
                describeSuggestion(
                    summary.name,
                    summary.nameEn,
                    summary.tags.map((tag) => tag.name),
                    summary.ingredients.map((ingredient) => ingredient.name)
                ),
                // Same canonical name => an error must MERGE. Layer 1 already
                // declined this pair on cuisine, so an adjudicator failure here
                // would otherwise store a suggestion that duplicates an existing
                // recipe — the "regenerated forever" bug this whole function
                // exists to prevent.
                { onError: sharesCanonicalName(dish.name, summary.name) }
            ));

        if (isSameDish) {
            console.log(
                `[Suggestions] "${dish.name}" already exists as recipe "${summary.name}" (score ${candidate.score.toFixed(3)}${autoMerge ? "" : ", adjudicated"})`
            );
            return summary;
        }
    }

    return null;
}
