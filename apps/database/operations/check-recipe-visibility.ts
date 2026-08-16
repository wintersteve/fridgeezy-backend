import { supabase, supabaseAdmin } from "@fridgeezy/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

/**
 * Proves the recipe visibility rule actually holds, by trying to break it.
 *
 * `20260815000005` states the risk this guards: `recipe_is_visible(created_by)`
 * has to hold in the `recipes` policy, in three child-table policies, and — since
 * `find_recipes` and `search_recipes` never consult a policy at all — inside
 * those two function bodies as well. "A divergence between any two of them is a
 * silent leak rather than an error." Nothing fails loudly when one of six places
 * forgets; a stranger simply starts seeing somebody's imported cookbook page.
 *
 * So this does not inspect definitions, it makes a real owned recipe with real
 * content and tries to reach it down every path, as each caller who must not.
 * A predicate can be present and still wrong, and reading the policy back would
 * only prove that somebody wrote one.
 *
 * Two callers, because they exercise different halves of the same predicate:
 *
 *  - A GUEST, where `current_profile_id()` is null. This is the broader exposure
 *    and the easier one to get right.
 *  - ANOTHER SIGNED-IN USER, where `current_profile_id()` returns a real id that
 *    simply is not the owner's. A rule reduced to `created_by is null or
 *    auth.uid() is not null` — one plausible slip — passes the guest half and
 *    hands every logged-in user everybody else's private recipes. Only the second
 *    caller notices, so the check creates two throwaway auth users and signs in
 *    as each.
 *
 * ## What it does NOT prove, and why
 *
 * - **A child table added LATER.** The tables below are named explicitly, so a
 *   future `recipe_equipment` with no policy is invisible to this script — which
 *   is precisely the realistic drift. Enumerating them needs `information_schema`,
 *   and PostgREST does not expose it. Run this by hand after adding one:
 *
 *     select tc.table_name from information_schema.table_constraints tc
 *       join information_schema.constraint_column_usage ccu
 *         on ccu.constraint_name = tc.constraint_name
 *      where tc.constraint_type = 'FOREIGN KEY'
 *        and ccu.table_name = 'recipes' and ccu.column_name = 'id';
 *
 *   Anything new that holds recipe CONTENT belongs in CONTENT_TABLES below.
 * - **`recipe_display_tags` / `recipe_dietary`.** Views without
 *   `security_invoker`, so they see past the policies. The migration records that
 *   as known and accepted — they expose tag names, not content — so this asserts
 *   nothing about them. If that decision is revisited, assert it here.
 *
 * SAFE TO RUN ANY TIME. Writes one recipe plus a row in each content table, and
 * two auth users at `@example.invalid` (a reserved TLD that cannot receive mail),
 * all removed in finally blocks. No LLM, no spend.
 *
 *   npx nx run @fridgeezy/database:check-recipe-visibility
 */

/** Throwaway users are named so a leaked one is obvious in the auth table. */
const TEST_EMAIL_PREFIX = "zz-visibility-check";

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok) pass++;
    else fail++;
};

async function guestCannotReach() {
    console.log("GUEST — no session at all:");

    const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .limit(1)
        .maybeSingle();

    if (!profile) {
        console.log("no profile row to own a test recipe — cannot run");
        process.exit(1);
    }

    let recipeId: string | null = null;

    try {
        const { data: created, error } = await supabaseAdmin
            .from("recipes")
            .insert({
                name: "ZZ Visibility Check — delete me",
                created_by: profile.id,
            })
            .select("id")
            .single();

        if (error) {
            throw new Error(`could not create the test recipe: ${error.message}`);
        }

        recipeId = created.id;

        // Content in every table that resolves visibility through the parent.
        // An ingredient needs a real id, so reuse whatever the catalogue has.
        const { data: ingredient } = await supabaseAdmin
            .from("ingredients")
            .select("id")
            .limit(1)
            .maybeSingle();
        const { data: tag } = await supabaseAdmin
            .from("tags")
            .select("id")
            .limit(1)
            .maybeSingle();

        await supabaseAdmin.from("recipe_instructions").insert({
            recipe_id: recipeId,
            step_number: 1,
            instruction_text: "ZZ Visibility Check — must never be readable",
        });

        if (ingredient) {
            await supabaseAdmin
                .from("recipe_ingredients")
                .insert({ recipe_id: recipeId, ingredient_id: ingredient.id });
        }
        if (tag) {
            await supabaseAdmin
                .from("recipe_tags")
                .insert({ recipe_id: recipeId, tag_id: tag.id });
        }

        // The control. Service role bypasses RLS, so this proves the fixture is
        // real — without it, every assertion below would pass on an empty table.
        const { data: asAdmin } = await supabaseAdmin
            .from("recipes")
            .select("id")
            .eq("id", recipeId);
        check("control: the owned recipe exists", (asAdmin ?? []).length === 1);

        // ---- the assertions, all as an unauthenticated caller ----

        const { data: row } = await supabase
            .from("recipes")
            .select("id")
            .eq("id", recipeId);
        check(
            "guest cannot read the recipe row",
            (row ?? []).length === 0,
            (row ?? []).length > 0 ? "LEAK" : ""
        );

        const { data: steps } = await supabase
            .from("recipe_instructions")
            .select("instruction_text")
            .eq("recipe_id", recipeId);
        check(
            "guest cannot read its instructions",
            (steps ?? []).length === 0,
            (steps ?? []).length > 0 ? "LEAK — the method is readable" : ""
        );

        if (ingredient) {
            const { data: ings } = await supabase
                .from("recipe_ingredients")
                .select("ingredient_id")
                .eq("recipe_id", recipeId);
            check(
                "guest cannot read its ingredients",
                (ings ?? []).length === 0,
                (ings ?? []).length > 0 ? "LEAK" : ""
            );
        }

        if (tag) {
            const { data: tags } = await supabase
                .from("recipe_tags")
                .select("tag_id")
                .eq("recipe_id", recipeId);
            check(
                "guest cannot read its tags",
                (tags ?? []).length === 0,
                (tags ?? []).length > 0 ? "LEAK" : ""
            );
        }

        // The feed. SECURITY DEFINER, so no policy applies and the filter has to
        // be inside the function — the case RLS cannot cover.
        const { data: feed, error: feedError } = await supabase.rpc(
            "find_recipes",
            { limit_count: 500, p_offset: 0 }
        );

        if (feedError) {
            check("find_recipes is callable as a guest", false, feedError.message);
        } else {
            const leaked = (feed ?? []).some(
                (candidate: { id: string }) => candidate.id === recipeId
            );
            check(
                "owned recipe is absent from find_recipes",
                !leaked,
                leaked ? "LEAK — it is in the shared feed" : ""
            );
        }
    } finally {
        if (recipeId) {
            // Children cascade; the parent is the only delete needed.
            await supabaseAdmin.from("recipes").delete().eq("id", recipeId);

            const { data: left } = await supabaseAdmin
                .from("recipes")
                .select("id")
                .eq("id", recipeId);
            check("test fixture cleaned up", (left ?? []).length === 0);
        }
    }
}

/**
 * The half a guest test cannot reach: a REAL session belonging to someone else.
 *
 * Creates two throwaway users, gives A a private recipe, and asks B for it. The
 * slip this exists for is a predicate that checks "is anyone logged in" rather
 * than "is it THIS person" — which a guest run passes cleanly while handing every
 * signed-in user everybody else's imports.
 *
 * A is asserted to SEE its own recipe as well. Without that the suite could pass
 * by hiding owned recipes from everyone including their owner, which is a
 * different bug wearing the same green tick.
 */
async function otherUserCannotReach() {
    console.log("\nOWNER vs OTHER USER — two real sessions:");

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        check("SUPABASE_URL and SUPABASE_ANON_KEY are set", false);
        return;
    }

    const stamp = Date.now();
    const users: { id: string; client: SupabaseClient }[] = [];
    let recipeId: string | null = null;

    /** Sign-in per user, on its own client so the two sessions cannot collide. */
    const makeUser = async (which: string) => {
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

        return { id: data.user.id, client };
    };

    try {
        users.push(await makeUser("a"), await makeUser("b"));
        const [ownerUser, otherUser] = users;

        // `current_profile_id()` maps auth.uid() -> profiles.id, so the recipe is
        // owned by A's PROFILE, not by its auth user.
        const { data: ownerProfile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("user_id", ownerUser.id)
            .single();

        if (!ownerProfile) {
            check("a profile row exists for the new user", false, "no trigger?");
            return;
        }

        const { data: created, error } = await supabaseAdmin
            .from("recipes")
            .insert({
                name: "ZZ Visibility Check (A vs B) — delete me",
                created_by: ownerProfile.id,
            })
            .select("id")
            .single();

        if (error) throw new Error(`could not create the recipe: ${error.message}`);
        recipeId = created.id;

        await supabaseAdmin.from("recipe_instructions").insert({
            recipe_id: recipeId,
            step_number: 1,
            instruction_text: "ZZ Visibility Check — only A may read this",
        });

        const ownerRows = await ownerUser.client
            .from("recipes")
            .select("id")
            .eq("id", recipeId);
        check(
            "the OWNER can read their own recipe",
            (ownerRows.data ?? []).length === 1,
            (ownerRows.data ?? []).length === 0
                ? "owner locked out of their own row"
                : ""
        );

        const otherRows = await otherUser.client
            .from("recipes")
            .select("id")
            .eq("id", recipeId);
        check(
            "another signed-in user cannot read the row",
            (otherRows.data ?? []).length === 0,
            (otherRows.data ?? []).length > 0 ? "LEAK" : ""
        );

        const otherSteps = await otherUser.client
            .from("recipe_instructions")
            .select("instruction_text")
            .eq("recipe_id", recipeId);
        check(
            "another signed-in user cannot read its instructions",
            (otherSteps.data ?? []).length === 0,
            (otherSteps.data ?? []).length > 0 ? "LEAK — the method is readable" : ""
        );

        const { data: feed } = await otherUser.client.rpc("find_recipes", {
            limit_count: 500,
            p_offset: 0,
        });
        const leaked = (feed ?? []).some(
            (row: { id: string }) => row.id === recipeId
        );
        check(
            "owned recipe is absent from another user's find_recipes",
            !leaked,
            leaked ? "LEAK — it is in their feed" : ""
        );
    } finally {
        if (recipeId) {
            await supabaseAdmin.from("recipes").delete().eq("id", recipeId);
        }

        // Deleting the auth user cascades to its profile.
        for (const user of users) {
            await supabaseAdmin.auth.admin.deleteUser(user.id);
        }

        const { data: strays } = await supabaseAdmin
            .from("recipes")
            .select("id")
            .ilike("name", "ZZ Visibility Check%");
        check("test users and recipe cleaned up", (strays ?? []).length === 0);
    }
}

async function main() {
    console.log("recipe visibility — an owned recipe must reach nobody else\n");

    await guestCannotReach();
    await otherUserCannotReach();

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
