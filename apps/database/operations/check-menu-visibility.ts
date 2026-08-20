import { supabase, supabaseAdmin } from "@fridgeezy/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

/**
 * Proves the menu visibility rule actually holds, by trying to break it.
 *
 * `20260821000001` opened `menus` and `menu_courses` to every reader and put
 * one predicate in their way — `menu_is_visible(owner_profile_id)`. Before that
 * migration a menu was own-profile under RLS and the worst a mistake could do
 * was hide something; now the default is that everybody can read every menu,
 * and the only thing standing between a private one and the home feed is a
 * column that `save_menu` has to compute correctly.
 *
 * That inverts where the danger is, which is why this exists. It is the same
 * argument `check-recipe-visibility` makes, one table over: nothing fails
 * loudly when the rule slips, a stranger simply starts seeing the name of a
 * dish somebody photographed out of their own cookbook.
 *
 * So this does not read policy definitions back. It composes a REAL menu around
 * a REAL owned recipe, through `save_menu`, and then tries to reach it as each
 * caller who must not — which also exercises the one computation the whole rule
 * rests on, rather than trusting it.
 *
 * Three callers, because they fail differently:
 *
 *  - The OWNER, who must still see it. Without this assertion the suite passes
 *    by hiding every menu from everybody, which is a different bug wearing the
 *    same green tick.
 *  - A GUEST, where `current_profile_id()` is null — the broad exposure, and
 *    the easy half to get right.
 *  - ANOTHER SIGNED-IN USER, where `current_profile_id()` returns a real id
 *    that simply is not the owner's. A predicate reduced to "is anybody logged
 *    in" passes the guest half cleanly and hands every account everybody
 *    else's private menus.
 *
 * It also asserts the two things that are not visibility but fail the same way:
 * that a client cannot WRITE `menus` / `menu_courses` at all (the migration
 * revokes the privilege, because a policy-less UPDATE silently matches zero
 * rows and returns 204 rather than erroring), and that a caller cannot insert a
 * `saved_menus` row pointing at a menu they cannot read — which would inflate
 * `saved_count` on somebody's private meal.
 *
 * ## What it does NOT prove, and why
 *
 * - **A menu whose privacy came from the MAIN rather than a course.**
 *   `save_menu` folds `recipes.created_by` of the main into `owner_profile_id`
 *   too. The fixture below makes the owned recipe the main AND a course, so
 *   both paths are covered at once — but if those two ever diverge, this stops
 *   distinguishing them.
 * - **Curation.** `menu_is_publishable` decides what is worth showing, not what
 *   is safe to show. A menu wrongly excluded from the strip is a product bug,
 *   not a leak, and nothing here asserts about it.
 *
 * SAFE TO RUN ANY TIME. Writes two throwaway auth users at `@example.invalid`
 * (a reserved TLD that cannot receive mail), three recipes and two menus, all
 * removed in finally blocks. No LLM, no spend.
 *
 * One caveat worth knowing on a shared database: two of the fixture recipes are
 * CATALOGUE rows (`created_by null`) for the few seconds the script runs, so
 * they are briefly in everyone's feed. They are named `ZZ Menu Check…` so a
 * leaked one is obvious.
 *
 *   npx nx run @fridgeezy/database:check-menu-visibility
 */

const TEST_EMAIL_PREFIX = "zz-menu-visibility-check";
const FIXTURE_PREFIX = "ZZ Menu Check";

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok) pass++;
    else fail++;
};

interface TestUser {
    id: string;
    profileId: string;
    client: SupabaseClient;
}

async function main() {
    console.log("menu visibility — an owned menu must reach nobody else\n");

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        check("SUPABASE_URL and SUPABASE_ANON_KEY are set", false);
        process.exit(1);
    }

    const stamp = Date.now();
    const users: TestUser[] = [];
    const recipeIds: string[] = [];
    const menuIds: string[] = [];

    /** Sign-in per user, on its own client so the two sessions cannot collide. */
    const makeUser = async (which: string): Promise<TestUser> => {
        const email = `${TEST_EMAIL_PREFIX}-${which}-${stamp}@example.invalid`;
        const password = `pw-${stamp}-${which}-Aa1!`;

        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (error || !data.user) {
            throw new Error(`could not create user ${which}: ${error?.message}`);
        }

        const client = createClient(url, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const { error: signInError } = await client.auth.signInWithPassword({
            email,
            password,
        });

        if (signInError) {
            throw new Error(`could not sign in ${which}: ${signInError.message}`);
        }

        // `current_profile_id()` maps auth.uid() -> profiles.id, so everything
        // below is owned by the PROFILE, not by the auth user.
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("user_id", data.user.id)
            .single();

        if (!profile) {
            throw new Error(`no profile row for ${which} — trigger missing?`);
        }

        return { id: data.user.id, profileId: profile.id, client };
    };

    const makeRecipe = async (label: string, ownerProfileId: string | null) => {
        const { data, error } = await supabaseAdmin
            .from("recipes")
            .insert({
                name: `${FIXTURE_PREFIX} ${label} ${stamp}`,
                created_by: ownerProfileId,
            })
            .select("id")
            .single();

        if (error) throw new Error(`could not create ${label}: ${error.message}`);

        recipeIds.push(data.id);
        return data.id as string;
    };

    try {
        users.push(await makeUser("a"), await makeUser("b"));
        const [owner, other] = users;

        // A's own imported page, plus two catalogue dishes to build with.
        const ownedId = await makeRecipe("owned", owner.profileId);
        const sideId = await makeRecipe("side", null);
        const publicMainId = await makeRecipe("public-main", null);

        // ---------------------------------------------------------------
        // The private fixture, composed through the real write path
        // ---------------------------------------------------------------

        const privateMenu = await owner.client.rpc("save_menu", {
            p_name: `${FIXTURE_PREFIX} private`,
            p_main_recipe_id: ownedId,
            p_courses: [
                { recipeId: ownedId, courseType: "main" },
                { recipeId: sideId, courseType: "side" },
            ],
        });

        if (privateMenu.error || !privateMenu.data) {
            check(
                "the owner can compose a menu around their own import",
                false,
                privateMenu.error?.message ?? "no row returned"
            );
            return;
        }

        const privateMenuId = (privateMenu.data as { id: string }).id;
        menuIds.push(privateMenuId);

        // The control. Service role bypasses RLS, so this proves the fixture is
        // real — without it every assertion below passes on an empty table.
        const { data: asAdmin } = await supabaseAdmin
            .from("menus")
            .select("id, owner_profile_id")
            .eq("id", privateMenuId);

        check("control: the menu exists", (asAdmin ?? []).length === 1);
        check(
            "control: save_menu marked it owned",
            (asAdmin ?? [])[0]?.owner_profile_id === owner.profileId,
            (asAdmin ?? [])[0]?.owner_profile_id
                ? ""
                : "LEAK AT SOURCE — owner_profile_id is null, so it is public"
        );

        // ---------------------------------------------------------------
        console.log("\nOWNER — must still see their own menu:");
        // ---------------------------------------------------------------

        const ownerMenu = await owner.client
            .from("menus")
            .select("id")
            .eq("id", privateMenuId);
        check(
            "the owner can read the menu row",
            (ownerMenu.data ?? []).length === 1,
            (ownerMenu.data ?? []).length === 0
                ? "owner locked out of their own menu"
                : ""
        );

        const ownerCourses = await owner.client
            .from("menu_courses")
            .select("name")
            .eq("menu_id", privateMenuId);
        check(
            "the owner can read its courses",
            (ownerCourses.data ?? []).length === 2,
            `${(ownerCourses.data ?? []).length} of 2`
        );

        // ---------------------------------------------------------------
        console.log("\nGUEST — no session at all:");
        // ---------------------------------------------------------------

        const guestMenu = await supabase
            .from("menus")
            .select("id")
            .eq("id", privateMenuId);
        check(
            "guest cannot read the menu row",
            (guestMenu.data ?? []).length === 0,
            (guestMenu.data ?? []).length > 0 ? "LEAK" : ""
        );

        const guestCourses = await supabase
            .from("menu_courses")
            .select("name")
            .eq("menu_id", privateMenuId);
        check(
            "guest cannot read its courses",
            (guestCourses.data ?? []).length === 0,
            (guestCourses.data ?? []).length > 0
                ? "LEAK — the snapshotted dish names are readable"
                : ""
        );

        const guestForRecipe = await supabase.rpc("community_menus_for_recipe", {
            p_recipe_id: ownedId,
            p_limit: 50,
        });
        check(
            "owned menu is absent from a guest's community_menus_for_recipe",
            !(guestForRecipe.data ?? []).some(
                (row: { menu_id: string }) => row.menu_id === privateMenuId
            )
        );

        const guestRecent = await supabase.rpc("recent_community_menus", {
            p_limit: 500,
        });
        check(
            "owned menu is absent from a guest's recent_community_menus",
            !(guestRecent.data ?? []).some(
                (row: { menu_id: string }) => row.menu_id === privateMenuId
            )
        );

        // ---------------------------------------------------------------
        console.log("\nANOTHER SIGNED-IN USER — a real session, wrong person:");
        // ---------------------------------------------------------------

        const otherMenu = await other.client
            .from("menus")
            .select("id")
            .eq("id", privateMenuId);
        check(
            "another user cannot read the menu row",
            (otherMenu.data ?? []).length === 0,
            (otherMenu.data ?? []).length > 0 ? "LEAK" : ""
        );

        const otherCourses = await other.client
            .from("menu_courses")
            .select("name")
            .eq("menu_id", privateMenuId);
        check(
            "another user cannot read its courses",
            (otherCourses.data ?? []).length === 0,
            (otherCourses.data ?? []).length > 0 ? "LEAK" : ""
        );

        const otherForRecipe = await other.client.rpc(
            "community_menus_for_recipe",
            { p_recipe_id: ownedId, p_limit: 50 }
        );
        check(
            "owned menu is absent from another user's community_menus_for_recipe",
            !(otherForRecipe.data ?? []).some(
                (row: { menu_id: string }) => row.menu_id === privateMenuId
            )
        );

        // Not visibility, but it fails the same way: `saved_menus` has a foreign
        // key onto `menus`, and FK checks bypass RLS. Without the WITH CHECK on
        // the policy, a guessed id would let anybody run up `saved_count` on a
        // menu they cannot read.
        const stolenSave = await other.client
            .from("saved_menus")
            .insert({ profile_id: other.profileId, menu_id: privateMenuId });
        check(
            "another user cannot save a menu they cannot read",
            stolenSave.error !== null,
            stolenSave.error === null ? "LEAK — the reference was accepted" : ""
        );

        // ---------------------------------------------------------------
        console.log("\nWRITE LOCKDOWN — every client is read-only here:");
        // ---------------------------------------------------------------
        //
        // Asserted as ERRORS rather than as zero rows affected. With RLS on and
        // no write policy, an UPDATE or DELETE quietly matches nothing and
        // returns 204 — so a stale client would appear to succeed. The migration
        // revokes the privilege for exactly this reason, and that is the half
        // worth testing.

        const tamperName = await other.client
            .from("menus")
            .update({ name: "pwned" })
            .eq("id", privateMenuId);
        check(
            "a client cannot UPDATE menus",
            tamperName.error !== null,
            tamperName.error === null ? "no error — is the revoke missing?" : ""
        );

        const tamperCourse = await other.client
            .from("menu_courses")
            .update({ name: "pwned" })
            .eq("menu_id", privateMenuId);
        check(
            "a client cannot UPDATE menu_courses",
            tamperCourse.error !== null,
            tamperCourse.error === null ? "no error — is the revoke missing?" : ""
        );

        const tamperDelete = await other.client
            .from("menus")
            .delete()
            .eq("id", privateMenuId);
        check(
            "a client cannot DELETE menus",
            tamperDelete.error !== null,
            tamperDelete.error === null ? "no error — is the revoke missing?" : ""
        );

        // ---------------------------------------------------------------
        console.log("\nSERVICE ROLE — the compose retrieval path:");
        // ---------------------------------------------------------------
        //
        // `menu_pairings_for_recipe` is read by the compose service as the
        // SERVICE ROLE, which bypasses RLS entirely. Every other reader here is
        // a real session with a policy in front of it; this one has only the
        // WHERE clause its own body carries. That inverts where the danger is,
        // so it is asserted with the strongest client in the suite rather than
        // the weakest — a leak here is invisible to every check above.

        const asService = await supabaseAdmin.rpc("menu_pairings_for_recipe", {
            p_recipe_id: ownedId,
            p_course_types: ["main", "side", "appetizer", "dessert"],
            p_per_course: 50,
        });

        check(
            "the retrieval RPC is callable as the service role",
            asService.error === null,
            asService.error?.message ?? ""
        );

        // The private menu pairs the owned main with `sideId`. Asking about the
        // owned recipe must not reveal what somebody put beside it.
        const leaked = (asService.data ?? []).some(
            (row: { dish_id: string }) => row.dish_id === sideId
        );
        check(
            "no course of an owned menu is returned to the service role",
            !leaked,
            leaked ? "LEAK — a private menu's pairing is readable" : ""
        );

        // ---------------------------------------------------------------
        console.log("\nTHE POSITIVE HALF — a shared menu must actually reach people:");
        // ---------------------------------------------------------------
        //
        // Everything above passes if menus are hidden from everybody. This is
        // what tells that apart from the rule working.

        const sharedMenu = await owner.client.rpc("save_menu", {
            p_name: `${FIXTURE_PREFIX} shared`,
            p_main_recipe_id: publicMainId,
            p_courses: [
                { recipeId: publicMainId, courseType: "main" },
                { recipeId: sideId, courseType: "side" },
            ],
        });

        if (sharedMenu.error || !sharedMenu.data) {
            check(
                "the owner can compose a catalogue-only menu",
                false,
                sharedMenu.error?.message ?? "no row returned"
            );
        } else {
            const sharedMenuId = (sharedMenu.data as { id: string }).id;
            menuIds.push(sharedMenuId);

            const guestShared = await supabase
                .from("menus")
                .select("id")
                .eq("id", sharedMenuId);
            check(
                "a guest CAN read a catalogue-only menu",
                (guestShared.data ?? []).length === 1,
                (guestShared.data ?? []).length === 0
                    ? "the rule is hiding shared menus too"
                    : ""
            );

            const otherShared = await other.client.rpc(
                "community_menus_for_recipe",
                { p_recipe_id: publicMainId, p_limit: 50 }
            );
            check(
                "another user finds it through community_menus_for_recipe",
                (otherShared.data ?? []).some(
                    (row: { menu_id: string }) => row.menu_id === sharedMenuId
                ),
                (otherShared.data ?? []).length === 0
                    ? "discovery returned nothing at all"
                    : ""
            );

            const ownerShared = await owner.client.rpc(
                "community_menus_for_recipe",
                { p_recipe_id: publicMainId, p_limit: 50 }
            );
            check(
                "but the SAVER does not — it is already in their saved meals",
                !(ownerShared.data ?? []).some(
                    (row: { menu_id: string }) => row.menu_id === sharedMenuId
                )
            );
        }
    } finally {
        // `menu_courses` cascades from the menu; nothing cascades from a recipe,
        // because `menu_courses.recipe_id` is polymorphic and carries no key.
        for (const menuId of menuIds) {
            await supabaseAdmin.from("menus").delete().eq("id", menuId);
        }
        for (const recipeId of recipeIds) {
            await supabaseAdmin.from("recipes").delete().eq("id", recipeId);
        }
        // Deleting the auth user cascades to its profile, and the profile to its
        // saved_menus rows.
        for (const user of users) {
            await supabaseAdmin.auth.admin.deleteUser(user.id);
        }

        const { data: strayMenus } = await supabaseAdmin
            .from("menus")
            .select("id")
            .ilike("name", `${FIXTURE_PREFIX}%`);
        const { data: strayRecipes } = await supabaseAdmin
            .from("recipes")
            .select("id")
            .ilike("name", `${FIXTURE_PREFIX}%`);

        check(
            "test fixtures cleaned up",
            (strayMenus ?? []).length === 0 && (strayRecipes ?? []).length === 0,
            `${(strayMenus ?? []).length} menus, ${(strayRecipes ?? []).length} recipes left`
        );
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
