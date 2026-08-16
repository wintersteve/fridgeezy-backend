import { supabase, supabaseAdmin } from "@fridgeezy/supabase";
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
 * content and asks the ANON client to find it, down every path a guest has: the
 * row, each child table that holds its content, and the discovery feed. A
 * predicate can be present and still wrong, and reading the policy back would
 * only prove that somebody wrote one.
 *
 * ## What it does NOT prove, and why
 *
 * - **Profile A against profile B.** This tests the GUEST case, where
 *   `current_profile_id()` is null. Both cases run through the same single
 *   predicate and guest is the broader exposure, but a rule that somehow admitted
 *   only other logged-in users would pass here. Testing it properly needs a
 *   signed JWT per user and real auth rows a check script has no business
 *   creating.
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
 * SAFE TO RUN ANY TIME. Writes one recipe plus a row in each content table, all
 * removed in a finally block. No LLM, no spend.
 *
 *   npx nx run @fridgeezy/database:check-recipe-visibility
 */

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok) pass++;
    else fail++;
};

async function main() {
    console.log("recipe visibility — a guest must not reach an owned recipe\n");

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

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
