import { supabaseAdmin } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";

/**
 * The cuisine the reader asked for, resolved into the two forms the search
 * needs.
 *
 * ## Why it needed a slot at all
 *
 * `find_recipes` has filtered on cuisine since it was written — its `tags` array
 * is generic, and it has expanded those tags through `tag_subtree` since
 * `20260803000002`. `GenerateSuggestionRequestDto.cuisine` has existed just as
 * long. The only missing piece was in the middle: the chat tool had thirteen
 * fields and none of them was `cuisine`, and its own descriptions told the model
 * three separate times to put a cuisine in the free-text `query`, where nothing
 * filters on it.
 *
 * So "give me an Asian dish containing eggs" routed the eggs and dropped the
 * Asian, and the search happily returned Banana Bread — the summary model even
 * said so in the reply ("while not traditionally considered an Asian dish").
 * Same shape as `exclude` in the first round of this work: declared downstream,
 * never routed.
 *
 * ## A REGION widens; a specific cuisine does not
 *
 * This is the part worth being careful with, and the schema settles it rather
 * than a rule here. `tags.parent_id` holds a real hierarchy — `thai ->
 * southeast asian -> asian` — and `tag_subtree` walks DOWN from whatever it is
 * given. Measured 2026-09-14 on the live vocabulary:
 *
 *   asian       -> 53 tags
 *   east asian  -> 12 tags
 *   thai        ->  1 tag (itself)
 *
 * So asking for Thai cannot quietly widen to everything Asian: Thai is a leaf
 * and its subtree is itself. The expansion only ever does something for a term
 * that genuinely has children.
 *
 * **The expansion is not optional, either.** The generator is told never to add
 * a region beside a specific cuisine ("italian must NOT also carry
 * mediterranean"), so no dish carries `asian` — measured, 0 recipes do, against
 * 7 thai and 7 korean. A direct tag match on a region returns nothing, forever,
 * which is the failure mode this whole round exists to stop.
 */
export interface CuisineFilter {
    /**
     * The terms as asked for, un-expanded.
     *
     * What `find_recipes` wants: it runs `tag_subtree` itself, so handing it the
     * expansion instead would make it demand a row satisfy all 53 Asian tags at
     * once — the RPC counts DISTINCT requested tags, and every id in the array
     * is one. The same trap `find_dishes_using_components` documents for
     * ingredient identity closure.
     */
    rootIds: string[];
    /**
     * The full subtree, for the stages that read tables directly and have to
     * check a row's tags in TypeScript.
     */
    subtreeIds: Set<string>;
    /**
     * How many DISTINCT terms were asked for, counted off the raw argument.
     *
     * The same construction `resolveDietaryFilter` uses: a name that resolves to
     * no tag has to make the filter unsatisfiable rather than being quietly
     * ignored, or "an Ethiopian dish" silently becomes "any dish".
     */
    requestedCount: number;
}

/**
 * Resolve cuisine NAMES to tag ids and their subtrees. Never throws — a failure
 * returns a filter that resolves nothing, which the caller reads as
 * unsatisfiable and answers by generating (where the cuisine IS honoured, in
 * the prompt).
 */
export async function resolveCuisineFilter(
    names: string[] | undefined
): Promise<CuisineFilter | null> {
    const canonical = [
        ...new Set(
            (names ?? [])
                .map(canonicalizeName)
                .filter((name): name is string => !!name)
        ),
    ];

    if (canonical.length === 0) return null;

    try {
        const { data, error } = await supabaseAdmin
            .from("tags")
            .select("id, canonical_id")
            .eq("type", "cuisine")
            .in("canonical_id", canonical);

        if (error) {
            console.error(
                `[CuisineFilter] Could not resolve ${JSON.stringify(canonical)}: ${error.message}`
            );

            return { rootIds: [], subtreeIds: new Set(), requestedCount: canonical.length };
        }

        const rootIds = (data ?? []).map((row) => row.id as string);

        if (rootIds.length === 0) {
            return { rootIds: [], subtreeIds: new Set(), requestedCount: canonical.length };
        }

        const subtree = await supabaseAdmin.rpc("tag_subtree", {
            root_ids: rootIds,
        });

        if (subtree.error) {
            console.error(
                `[CuisineFilter] tag_subtree failed: ${subtree.error.message}`
            );

            // Fall back to the roots themselves. Narrower than intended and
            // therefore safe: it can only fail to match, never match wrongly.
            return {
                rootIds,
                subtreeIds: new Set(rootIds),
                requestedCount: canonical.length,
            };
        }

        return {
            rootIds,
            subtreeIds: new Set(
                (subtree.data ?? []).map(
                    (row: { tag_id: string }) => row.tag_id
                )
            ),
            requestedCount: canonical.length,
        };
    } catch (error) {
        console.error("[CuisineFilter] resolution failed:", error);

        return null;
    }
}
