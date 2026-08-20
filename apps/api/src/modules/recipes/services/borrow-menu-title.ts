import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * The name of a real menu that contains this whole meal, or null.
 *
 * Only reached when NOTHING was generated — the one case with no `menu_title`
 * line, because that line comes free with the LLM call. Without it the client
 * falls back to the main course's name, which is the exact heading the `menu`
 * frame was introduced to replace: "Coq au Vin" printed directly above a course
 * row called "Coq au Vin".
 *
 * ## The intersection is what makes it honest
 *
 * Every retrieved dish carries the menus it was found in. A NON-EMPTY
 * intersection means one single menu holds the base plus every dish chosen, so
 * its title genuinely describes at least this meal. Borrowing the top-ranked
 * SOURCE menu's title instead would put "Thai Table" over a set whose appetizer
 * came from one menu and whose dessert came from another — a title that
 * describes a meal nobody composed.
 *
 * Preferring the menu whose `course_count` matches this composition exactly is
 * not cosmetic either: that is the row `save_menu` will dedup onto when the user
 * saves, so the heading on screen and the `saved_menus.label` written a moment
 * later end up the same string instead of quietly disagreeing.
 *
 * Returns the RAW name. The caller runs it through `cleanMenuTitle`, because
 * `save_menu` can write `''` and `ComposeRecipeMenuDtoSchema` is `min(1)` —
 * parsed inside the route's streaming loop, where a throw loses the whole
 * composition rather than one frame.
 */
export async function borrowMenuTitle(
    menuIdsPerDish: string[][],
    courseCount: number
): Promise<string | null> {
    if (menuIdsPerDish.length === 0) return null;

    const shared = menuIdsPerDish.reduce<string[]>(
        (acc, ids) => acc.filter((id) => ids.includes(id)),
        [...menuIdsPerDish[0]]
    );

    if (shared.length === 0) return null;

    try {
        const { data, error } = await supabaseAdmin
            .from("menus")
            .select("name, course_count, saved_count")
            .in("id", shared)
            // Restated rather than left to RLS: this reads as the service role,
            // so the policy on `menus` is not running. A private menu must not
            // lend its title to anybody.
            .is("owner_profile_id", null)
            .order("saved_count", { ascending: false });

        if (error || !data?.length) return null;

        const exact = data.find((menu) => menu.course_count === courseCount);

        return (exact ?? data[0]).name ?? null;
    } catch (error) {
        // A title is a nicety; the composition is not. Falling back to the
        // client's own heading costs a worse heading, not a menu.
        console.error("[MenuPairings] borrowing a title failed:", error);
        return null;
    }
}
