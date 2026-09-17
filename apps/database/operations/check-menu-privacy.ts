import { supabaseAdmin } from "@fridgeezy/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

/**
 * Proves a menu somebody put together themselves stays theirs.
 *
 *   npx nx run @fridgeezy/database:check-menu-privacy
 *
 * `20260916000002` made `record_menu` able to file a composition under its
 * composer instead of into the shared corpus, on one input: `p_private`. The
 * client sets it from provenance — every course matched or proposed means the
 * pairing layer vouched for the combination, anything else means the reader
 * assembled it themselves — so a sushi main beside a grilled cheese is recorded
 * privately and never reaches anybody else's compose sheet.
 *
 * Nothing fails LOUDLY when that slips. `menu_is_visible` and
 * `menu_is_publishable` both already require `owner_profile_id is null`, so the
 * whole rule reduces to one column being computed correctly — and a mistake
 * shows up as a stranger's odd dinner appearing on the community rail, weeks
 * later, with nothing in any log. That is the same argument
 * `check-menu-visibility` makes one table over, and this is its other half:
 * that one proves an OWNED menu stays hidden, this one proves a menu BECOMES
 * owned when it should.
 *
 * ## The seven behaviours, and why each is here
 *
 *  1. A private record is owned by its composer.
 *  2. Two profiles recording the SAME dishes privately get two rows. This is
 *     the trap `menus_identity_key` had to change for: with the old
 *     `unique (main_recipe_id, dish_signature)` the second composer's insert
 *     collided, fell into the re-select, and read back the FIRST composer's
 *     row — which RLS then hid from them, leaving a saved meal pointing at a
 *     menu they cannot open.
 *  3. Re-recording is idempotent for the same profile.
 *  4. A caller cannot PUBLISH over a private row they already hold. The heart
 *     on `saved-menu-detail` re-sends the courses it is showing, so without
 *     this a reader re-saving their own private meal would push it into the
 *     corpus.
 *  5. A vouched-for combination still reaches the shared corpus. Without this
 *     assertion the suite passes by making everything private, which is a
 *     different bug wearing the same green tick.
 *  6. Recording an ALREADY-PUBLIC combination privately lands on the public
 *     row rather than minting a private duplicate — the information is already
 *     out, and a second row would split `saved_count` between two rows
 *     describing one dinner.
 *  7. A private menu is not publishable, which is what actually keeps it off
 *     the three discovery reads.
 *
 * SAFE TO RUN ANY TIME. Writes two throwaway auth users at `@example.invalid`
 * (a reserved TLD that cannot receive mail) and a handful of menus, all removed
 * in a finally block. No LLM, no spend.
 */

/**
 * Read once and narrowed here, so the two `createClient` calls below do not
 * each have to re-prove the strings are present.
 */
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
}

interface Actor {
    userId: string;
    profileId: string;
    client: SupabaseClient;
}

let failures = 0;

const assert = (ok: boolean, what: string, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : `\n    ${detail}`}`);
};

async function makeActor(label: string): Promise<Actor> {
    const email = `pairing-${label}-${Date.now()}@example.invalid`;
    const password = `${Math.random().toString(36).slice(2)}Aa1!`;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });

    if (error || !data.user) {
        throw new Error(`creating ${label}: ${error?.message}`);
    }

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
    });

    if (signInError) throw new Error(`signing in ${label}: ${signInError.message}`);

    // `handle_new_user()` writes the profile on the auth insert, so by the time
    // the sign-in returns it exists. Read rather than assumed — a missing
    // profile would otherwise surface as `record_menu` refusing, which reads
    // like a failure of the thing under test.
    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", data.user.id)
        .maybeSingle();

    if (profileError || !profile) {
        throw new Error(`no profile for ${label}: ${profileError?.message}`);
    }

    return { userId: data.user.id, profileId: profile.id, client };
}

const courses = (...recipeIds: string[]) =>
    recipeIds.map((recipeId, index) => ({
        recipeId,
        courseType: index === 0 ? "main" : index === 1 ? "side" : "dessert",
    }));

async function main() {
    const { data: recipes, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name")
        .is("created_by", null)
        .limit(4);

    if (error || !recipes || recipes.length < 3) {
        throw new Error(
            "need at least three catalogue recipes to compose with — seed the local database first"
        );
    }

    const [main, side, dessert] = recipes;
    const alice = await makeActor("alice");
    const bob = await makeActor("bob");
    const written: string[] = [];

    const record = async (
        actor: Actor,
        dishes: { recipeId: string; courseType: string }[],
        isPrivate: boolean
    ) => {
        const { data, error: rpcError } = await actor.client.rpc("record_menu", {
            p_name: "Check menu",
            p_main_recipe_id: main.id,
            p_courses: dishes,
            p_private: isPrivate,
        });

        if (rpcError) throw new Error(`record_menu: ${rpcError.message}`);

        const menu = data as unknown as {
            id: string;
            owner_profile_id: string | null;
            course_count: number;
        };

        if (!written.includes(menu.id)) written.push(menu.id);

        return menu;
    };

    try {
        const three = courses(main.id, side.id, dessert.id);
        const two = courses(main.id, side.id);

        // 1
        const aPrivate = await record(alice, three, true);
        assert(
            aPrivate.owner_profile_id === alice.profileId,
            "a private record is owned by its composer",
            `owner was ${aPrivate.owner_profile_id}, expected ${alice.profileId}`
        );

        // 2 — the identity-key trap
        const bPrivate = await record(bob, three, true);
        assert(
            bPrivate.id !== aPrivate.id &&
                bPrivate.owner_profile_id === bob.profileId,
            "two composers of the same private set get separate rows",
            "menus_identity_key must include owner_profile_id (NULLS NOT DISTINCT)"
        );

        // 3
        const aAgain = await record(alice, three, true);
        assert(aAgain.id === aPrivate.id, "re-recording privately is idempotent");

        // 4
        const aPublishAttempt = await record(alice, three, false);
        assert(
            aPublishAttempt.id === aPrivate.id &&
                aPublishAttempt.owner_profile_id === alice.profileId,
            "a caller cannot publish over a private row they already hold",
            "re-saving a private meal would otherwise push it into the shared corpus"
        );

        // 5
        const shared = await record(bob, two, false);
        assert(
            shared.owner_profile_id === null,
            "a vouched-for combination still reaches the shared corpus",
            "everything being private would pass every other case here"
        );

        // 6
        const aOnShared = await record(alice, two, true);
        assert(
            aOnShared.id === shared.id,
            "an already-public combination is not duplicated privately",
            "a second row would split saved_count across two rows for one dinner"
        );

        // 7
        const { data: publishable, error: publishError } = await supabaseAdmin.rpc(
            "menu_is_publishable",
            {
                p_menu_id: aPrivate.id,
                p_owner_profile_id: aPrivate.owner_profile_id,
                p_course_count: aPrivate.course_count,
            }
        );

        if (publishError) throw new Error(`menu_is_publishable: ${publishError.message}`);

        assert(
            publishable === false,
            "a private menu is not publishable",
            "this is what keeps it off the rail, the examples sheet and compose retrieval"
        );

        // And the half that check-menu-visibility owns, restated here because
        // it is the consequence the whole feature is FOR: Bob must not be able
        // to read Alice's private dinner at all.
        const { data: seen } = await bob.client
            .from("menus")
            .select("id")
            .eq("id", aPrivate.id)
            .maybeSingle();

        assert(
            seen === null,
            "another signed-in reader cannot see a private menu",
            "RLS menu_is_visible should hide it"
        );
    } finally {
        if (written.length > 0) {
            await supabaseAdmin.from("menus").delete().in("id", written);
        }
        await supabaseAdmin.auth.admin.deleteUser(alice.userId);
        await supabaseAdmin.auth.admin.deleteUser(bob.userId);
    }

    console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} failed`);
    if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
