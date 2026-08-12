import { RecipesRepository } from "@fridgeezy/supabase";

import { fetchRecipeSummary } from "../../recipes/services/fetch-recipe-summary";

import { findSuggestionByName } from "./find-suggestion-by-name";
import { pickIdentityMatch } from "./pick-identity-match";
import type { SuggestionOutcome } from "./suggestion-outcome";

/**
 * Is this exact dish name already in the catalog?
 *
 * Two indexed lookups, no LLM call and no embedding — the cheapest possible
 * answer to "have we seen this dish before". Returns the outcome to settle with
 * on a hit, or `null` to mean "unknown, do the real work".
 *
 * ## Why this runs BEFORE the authenticity review
 *
 * The review is the single most expensive step in the suggestion pipeline —
 * measured at **77% of the token cost of a four-card batch** — and it runs on
 * every card, because it was deliberately moved to the front so that dedup keys
 * off the canonical name rather than whatever the generator happened to pick.
 *
 * That reorder is right and this does not undo it. A dish already in the catalog
 * under this exact name was reviewed when it was first stored: it passed the
 * gate, and its stored name IS the canonical one. Asking the model the same
 * question again about the same dish buys nothing.
 *
 * **This is not the parallel start that `persistOrReuseSuggestion` warns
 * against.** That failure was running the review *concurrently* with dedup and
 * awaiting it last, so every layer compared a non-canonical name. This is a
 * sequential pre-check on an exact string match: it either answers definitively
 * and returns, or it defers to the unchanged pipeline. Nothing downstream sees a
 * different name than it would have.
 *
 * ## The ordering inside it is the same ordering, for the same reason
 *
 * Recipes are checked before suggestions. A promoted dish exists as a recipe
 * while a stale suggestion row for it may still be lying around; answering from
 * suggestions first would keep handing that stale row back and the user would be
 * offered a dish they already have — the exact bug the main pipeline's layer
 * ordering exists to prevent.
 *
 * ## What it deliberately does NOT catch
 *
 * A dish whose generated name differs from its canonical one (`Pain Aux
 * Bananes` for banana bread) misses here and falls through to the full path,
 * where the review renames it and dedup collapses it as before. That is the
 * design: this only skips work when the answer is already certain, and a
 * near-miss is not certainty.
 *
 * **A name hit under a DISJOINT cuisine is now the second such case.** One
 * canonical name can carry two dishes (Turkish Mantı, Kazakh Manti), so a name
 * match alone is no longer certainty — it used to be treated as such, which is
 * how the second dish came to be silently replaced by the first with no LLM, no
 * embedding and nothing logged. When the cuisines do not relate, this returns
 * null and defers.
 *
 * That deferral costs the review this function exists to skip, and that is the
 * right trade: it is paid only on a genuinely ambiguous name hit, and it is what
 * buys the canonical name the layers below key on. **Step 0 must never become a
 * write path** — it answers or it defers.
 */
export async function findKnownDish(
    name: string,
    nameAlt: string | null | undefined,
    /** The dish's identity cuisine. Null means unknown, which merges. */
    cuisine: string | null,
    recipesRepo: RecipesRepository = new RecipesRepository()
): Promise<SuggestionOutcome | null> {
    // Layer 1: recipes win. Same precedence as the full pipeline.
    const recipes = await recipesRepo.findBaseRecipes([name, nameAlt]);

    if (recipes.success && recipes.value.length > 0) {
        const match = await pickIdentityMatch(
            { name, cuisine },
            recipes.value.map((row) => ({
                row,
                identityCuisine: row.identityCuisine,
                label: row.name,
            }))
        );

        if (match) {
            const summary = await fetchRecipeSummary(match.id);

            // A row that will not load is not a usable answer — fall through and
            // let the full path decide, rather than dropping the card.
            if (summary) {
                return { kind: "existing_recipe", recipe: summary };
            }
        }
    }

    // Layer 2: an existing suggestion under this exact canonical name.
    const suggestion = await findSuggestionByName(name, cuisine);

    if (suggestion) {
        return { kind: "suggestion", suggestion, reused: true };
    }

    return null;
}
