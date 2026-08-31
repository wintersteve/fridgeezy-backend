import { supabaseAdmin } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

/**
 * The user's diet, resolved once into the three forms the catalogue stages need.
 *
 * ## Why this exists
 *
 * `searchRecipeSuggestions` has taken `dietaryRestrictions` since it was
 * written and used it in exactly two places — `streamSingleSuggestion` and
 * `generateSuggestionsStream`, both of which are STAGE 3. Every stage that
 * returns a dish the catalogue already holds (1a exact name, 1b vector, 1c
 * `find_recipes`, 2 suggestions) never saw it.
 *
 * And retrieval wins by design: the whole point of the ladder is to hand back a
 * catalogue hit before paying for a generation. So the dish the model would
 * have written was vegan, and the dish the reader actually got was Carbonara.
 * The asymmetry that hid it is that `blacklist` WAS forwarded to stage 1c, so
 * half the constraint machinery looked right.
 *
 * ## The two kinds of diet, and why both have to be carried
 *
 * `find_recipes` already draws this distinction and this mirrors it exactly,
 * because the two must agree or a dish qualifies on one screen and not on
 * another:
 *
 * - a **derivable** diet has a `dietary_rules` row, so it is answered from the
 *   recipe's INGREDIENTS via `recipe_dietary` — three-valued and failing
 *   closed, so an unclassified ingredient means "unknown" and unknown does not
 *   qualify;
 * - everything else (halal, kosher, keto, low carb, low fat, low sodium, high
 *   protein, flexitarian — eight of the nineteen) has no rule to derive from
 *   and is answered from the tags the row CARRIES.
 *
 * Getting that wrong is the failure `menu_pairings_for_recipe`'s header
 * records: a `recipe_dietary`-only test returns nothing, forever and silently,
 * to everyone on one of those eight.
 */
export interface DietaryFilter {
    /**
     * Every resolved diet as a tag id, for `find_recipes`' own `tags` array.
     * Stage 1c needs nothing else — the RPC applies both rules itself.
     */
    tagIds: string[];
    /** Derivable diets, as `dietary_rules.diet_canonical_id`. */
    derivable: string[];
    /** The rest, as tag ids, matched against the row's own tags. */
    tagOnly: string[];
}

/**
 * Resolve diet NAMES ("vegan", "gluten free") to the ids the catalogue matches
 * on. Returns null when there is nothing to filter by.
 *
 * ## Names in, and matched by canonicalising BOTH sides
 *
 * The client sends `tags.name` — that is what `useChatConversation` reads off
 * `profile_dietary_preferences` — so what arrives is "gluten free", not a uuid
 * and not `gluten_free`. `canonicalizeName` is applied to the stored name as
 * well as to the argument, which is the one use its own docstring sanctions:
 * both sides normalised here, neither compared against a stored `canonical_id`
 * (those are trigger-stamped by a different rule, and the two disagree on edge
 * underscores). It also means "Gluten-Free", "gluten_free" and "gluten free"
 * all land on the same row, which matters because three different callers word
 * this three ways.
 *
 * The whole dietary vocabulary is nineteen rows, so it is read in full and
 * matched in memory rather than asking the database to normalise for us.
 *
 * ## An unresolvable name fails CLOSED
 *
 * It is dropped from `tagIds` — which `find_recipes` counts off the raw
 * argument — but it is also reported by the caller-visible fact that the filter
 * is non-null with fewer tags than names. A diet nobody can resolve is a
 * vocabulary drift, not a preference to ignore; the safe direction is to let
 * the catalogue stages come back empty and fall through to generation, where
 * the restriction is honoured in the prompt. Cost: one generation that dedup
 * usually folds back onto the very row we declined to serve. That is the same
 * asymmetry `DEFAULT_MATCH_THRESHOLD` is set by.
 */
export async function resolveDietaryFilter(
    names: string[] | undefined
): Promise<DietaryFilter | null> {
    const wanted = new Set(
        (names ?? [])
            .map(canonicalizeName)
            .filter((name): name is string => !!name)
    );

    if (wanted.size === 0) return null;

    const { data, error } = await supabaseAdmin
        .from("tags")
        .select("id, name, canonical_id")
        .eq("type", "dietary");

    if (error) {
        console.error(
            "[DietaryFilter] Failed to read the dietary vocabulary:",
            error.message
        );
        // Nothing resolved, and a filter was asked for. Fail closed — see the
        // note above.
        return { tagIds: [], derivable: [], tagOnly: [] };
    }

    const { data: rules, error: rulesError } = await supabaseAdmin
        .from("dietary_rules")
        .select("diet_canonical_id");

    if (rulesError) {
        console.error(
            "[DietaryFilter] Failed to read dietary_rules:",
            rulesError.message
        );

        return { tagIds: [], derivable: [], tagOnly: [] };
    }

    const derivableIds = new Set(
        (rules ?? []).map((rule) => rule.diet_canonical_id)
    );

    const tagIds: string[] = [];
    const derivable: string[] = [];
    const tagOnly: string[] = [];

    for (const tag of data ?? []) {
        if (!wanted.has(canonicalizeName(tag.name) ?? "")) continue;

        tagIds.push(tag.id);

        if (derivableIds.has(tag.canonical_id)) {
            derivable.push(tag.canonical_id);
        } else {
            tagOnly.push(tag.id);
        }
    }

    if (tagIds.length < wanted.size) {
        console.warn(
            `[DietaryFilter] ${wanted.size - tagIds.length} of ${wanted.size} dietary restriction(s) did not resolve to a tag — the catalogue stages will decline rather than guess`
        );
    }

    return { tagIds, derivable, tagOnly };
}

/**
 * Whether the filter can be satisfied at all.
 *
 * False when a restriction was asked for and nothing resolved — the fail-closed
 * case above, where every candidate has to be declined.
 */
const isUnsatisfiable = (filter: DietaryFilter, requested: number): boolean =>
    requested > 0 && filter.tagIds.length < requested;

/**
 * Of the given recipes, which satisfy EVERY diet in the filter.
 *
 * All-of, like `find_recipes`: "vegan AND gluten free" means both. A row that
 * cannot be checked — because a read failed — is not in the returned set, which
 * is the fail-closed direction.
 *
 * Batched: the caller collects its candidates from several stages and asks
 * once, rather than paying a round trip per stage.
 */
export async function qualifyingRecipeIds(
    recipeIds: string[],
    filter: DietaryFilter,
    requestedCount: number
): Promise<Set<string>> {
    if (recipeIds.length === 0) return new Set();
    if (isUnsatisfiable(filter, requestedCount)) return new Set();

    const ids = [...new Set(recipeIds)];
    const satisfied = new Map<string, Set<string>>(
        ids.map((id) => [id, new Set<string>()])
    );

    try {
        const [derived, tagged] = await Promise.all([
            filter.derivable.length
                ? supabaseAdmin
                      .from("recipe_dietary")
                      .select("recipe_id, diet_canonical_id")
                      .in("recipe_id", ids)
                      .in("diet_canonical_id", filter.derivable)
                : Promise.resolve({ data: [], error: null }),
            filter.tagOnly.length
                ? supabaseAdmin
                      .from("recipe_tags")
                      .select("recipe_id, tag_id")
                      .in("recipe_id", ids)
                      .in("tag_id", filter.tagOnly)
                : Promise.resolve({ data: [], error: null }),
        ]);

        if (derived.error || tagged.error) {
            console.error(
                "[DietaryFilter] Recipe dietary read failed — declining every candidate:",
                derived.error?.message ?? tagged.error?.message
            );

            return new Set();
        }

        for (const row of derived.data ?? []) {
            if (!row.recipe_id || !row.diet_canonical_id) continue;
            satisfied.get(row.recipe_id)?.add(row.diet_canonical_id);
        }

        for (const row of tagged.data ?? []) {
            satisfied.get(row.recipe_id)?.add(row.tag_id);
        }
    } catch (error) {
        console.error("[DietaryFilter] Recipe dietary read threw:", error);

        return new Set();
    }

    const required = filter.derivable.length + filter.tagOnly.length;

    return new Set(
        ids.filter((id) => (satisfied.get(id)?.size ?? 0) === required)
    );
}

/** {@link qualifyingRecipeIds}, for the suggestions half of the catalogue. */
export async function qualifyingSuggestionIds(
    suggestionIds: string[],
    filter: DietaryFilter,
    requestedCount: number
): Promise<Set<string>> {
    if (suggestionIds.length === 0) return new Set();
    if (isUnsatisfiable(filter, requestedCount)) return new Set();

    const ids = [...new Set(suggestionIds)];
    const satisfied = new Map<string, Set<string>>(
        ids.map((id) => [id, new Set<string>()])
    );

    try {
        const [derived, tagged] = await Promise.all([
            filter.derivable.length
                ? supabaseAdmin
                      .from("recipe_suggestion_dietary")
                      .select("recipe_suggestion_id, diet_canonical_id")
                      .in("recipe_suggestion_id", ids)
                      .in("diet_canonical_id", filter.derivable)
                : Promise.resolve({ data: [], error: null }),
            filter.tagOnly.length
                ? supabaseAdmin
                      .from("recipe_suggestion_tags")
                      .select("recipe_suggestion_id, tag_id")
                      .in("recipe_suggestion_id", ids)
                      .in("tag_id", filter.tagOnly)
                : Promise.resolve({ data: [], error: null }),
        ]);

        if (derived.error || tagged.error) {
            console.error(
                "[DietaryFilter] Suggestion dietary read failed — declining every candidate:",
                derived.error?.message ?? tagged.error?.message
            );

            return new Set();
        }

        for (const row of derived.data ?? []) {
            if (!row.recipe_suggestion_id || !row.diet_canonical_id) continue;
            satisfied
                .get(row.recipe_suggestion_id)
                ?.add(row.diet_canonical_id);
        }

        for (const row of tagged.data ?? []) {
            satisfied.get(row.recipe_suggestion_id)?.add(row.tag_id);
        }
    } catch (error) {
        console.error("[DietaryFilter] Suggestion dietary read threw:", error);

        return new Set();
    }

    const required = filter.derivable.length + filter.tagOnly.length;

    return new Set(
        ids.filter((id) => (satisfied.get(id)?.size ?? 0) === required)
    );
}
