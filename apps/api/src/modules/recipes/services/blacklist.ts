import { RecipesRepository } from "@fridgeezy/supabase";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";

/**
 * Does a recipe contain something the caller cannot eat?
 *
 * ## Why this exists
 *
 * Every path that WRITES a recipe already honours the blacklist — the
 * suggestion generator swaps the item out, and the promote prompt is told never
 * to reintroduce it. The paths that REUSE a recipe did not, because reuse was
 * built to answer a different question: "have we already paid to generate this
 * dish?" For that, a name match is the whole answer. The moment the caller has
 * a blacklist, the dish being right stops implying the recipe is usable, and a
 * shortcut that only checks the name serves the one recipe this user opened the
 * app to avoid.
 *
 * ## Matching by canonical id, not by string
 *
 * `ingredientCanonicalId` is the rule `ingredients.canonical_id` is built with,
 * so "Peanuts", "peanut" and "PEANUT" are one thing on both sides. Comparing
 * raw names would miss the plural, which is the spelling a user is most likely
 * to type into a blacklist and the least likely to appear in a recipe.
 *
 * ## What it deliberately does NOT do
 *
 * No substring matching. "Butter" must not match "butternut squash", and
 * "milk" must not match "milk thistle" — a false positive here throws away a
 * usable recipe and spends an LLM call adapting a dish that was already fine.
 * Ingredient identity in this schema is the canonical id and nothing else; if a
 * blacklist needs to cover a family ("all nuts"), that is `parent_id` on
 * `ingredients` doing it, not a `LIKE`.
 */
export type BlacklistMatcher = (ingredientNames: string[]) => string[];

/**
 * Compile a blacklist into a reusable matcher. Returns null for an empty or
 * absent list, so callers can branch on "there is nothing to check" once rather
 * than at every call site.
 */
export function compileBlacklist(
    blacklist: string[] | undefined | null
): BlacklistMatcher | null {
    const wanted = new Map<string, string>();

    for (const name of blacklist ?? []) {
        const canonical = ingredientCanonicalId(name ?? "");

        if (canonical) {
            // Keyed on the canonical id, valued with the name the USER wrote —
            // that is the spelling any message about this belongs in.
            wanted.set(canonical, name.trim());
        }
    }

    if (wanted.size === 0) {
        return null;
    }

    return (ingredientNames: string[]): string[] => {
        const hits = new Set<string>();

        for (const name of ingredientNames) {
            const offender = wanted.get(ingredientCanonicalId(name ?? ""));

            if (offender) {
                hits.add(offender);
            }
        }

        return [...hits];
    };
}

/**
 * What a reuse shortcut may actually hand back.
 *
 * `serve` — this recipe id is safe for the caller; return it as-is.
 * `adapt`  — nothing in the family clears the blacklist. `recipeId` is the best
 *            source material to adapt FROM (the base, which carries the likes
 *            and the image), and `offending` is what it contains that the caller
 *            cannot eat.
 */
export type ReuseDecision =
    | { serve: string }
    | { adapt: { recipeId: string; offending: string[] } };

/**
 * Given the recipe a reuse shortcut landed on, decide what the caller gets.
 *
 * Searches the whole FAMILY rather than just the candidate, and that is where
 * most of the value is: the first user with a peanut allergy pays for one
 * adaptation, and every user after them — including that user on their next
 * promote of the same dish — is served the variant that already exists. It is
 * what makes an adaptation idempotent without storing whose blacklist it was
 * written for; the ingredients are the record.
 *
 * ## Fails CLOSED
 *
 * A family read that errors returns `adapt`, not `serve`. Not being able to
 * verify a recipe is not evidence that it is fine, and the two outcomes are not
 * symmetrical: a needless adaptation costs one LLM call, while a wrong `serve`
 * puts a blacklisted ingredient in front of someone who told us they cannot eat
 * it. Same direction the dietary views take (`dietary_classified_at IS NULL`
 * disqualifies) and for the same reason.
 */
export async function decideReuse(
    repository: RecipesRepository,
    candidateId: string,
    matcher: BlacklistMatcher | null,
    blacklist: string[]
): Promise<ReuseDecision> {
    if (!matcher) {
        return { serve: candidateId };
    }

    const family = await repository.listFamilyVersions(candidateId);

    if (!family.success) {
        console.error(
            `[Blacklist] Could not read the family of ${candidateId}: ${family.error.message}`
        );
        return { adapt: { recipeId: candidateId, offending: blacklist } };
    }

    // Base first (listFamilyVersions guarantees the ordering), so a dish whose
    // catalogue copy is already fine never looks at anybody's variant.
    for (const version of family.value) {
        if (matcher(version.ingredientNames).length === 0) {
            return { serve: version.id };
        }
    }

    const base = family.value.find((version) => version.isBase);
    const source = base ?? family.value[0];

    if (!source) {
        // The candidate has no rows at all — it was deleted between the
        // shortcut's lookup and this one. Nothing to adapt from.
        return { adapt: { recipeId: candidateId, offending: blacklist } };
    }

    const offending = matcher(source.ingredientNames);

    return {
        adapt: {
            recipeId: source.id,
            offending: offending.length > 0 ? offending : blacklist,
        },
    };
}
