/**
 * Does `record_ingredient_substitution` actually hold what it claims to?
 *
 * The third of the family `check-recipe-visibility` and `check-menu-visibility`
 * started, and here for their reason: this function is SECURITY DEFINER, so it
 * sees past every policy on `recipes`, and the visibility rule is therefore
 * applied by hand inside it. A hand-applied rule can be present and still
 * wrong, which is why this drives the real function against a real database
 * rather than reading the definition back.
 *
 * It builds two signed-in users, a catalogue recipe and an owned one, and
 * asserts both directions: that the write works and derives what it should,
 * and that none of the four ways round it do.
 *
 * Local only, and it says so before it starts — it creates and deletes auth
 * users. Run it after touching the function, the table's policies, or
 * `recipe_is_visible`.
 */
import "dotenv/config";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@fridgeezy/supabase";

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

let failures = 0;
const check = (label: string, ok: boolean, note = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "  ok  " : " FAIL "} ${label}${note ? ` — ${note}` : ""}`);
};

const stamp = Date.now();

const makeUser = async (which: string) => {
    const email = `zz-subs-${which}-${stamp}@example.invalid`;
    const password = `pw-${stamp}-${which}-Aa1!`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create ${which}: ${error?.message}`);

    const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`sign in ${which}: ${signInError.message}`);

    const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", data.user.id)
        .single();

    return { id: data.user.id, profileId: profile!.id, client };
};

const main = async () => {
    if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
        console.error(`refusing to run against ${url}`);
        process.exit(1);
    }

    const anon = createClient(url, anonKey, { auth: { persistSession: false } });

    const a = await makeUser("a");
    const b = await makeUser("b");

    const { data: unit } = await supabaseAdmin.from("units").select("id").limit(1).single();
    const { data: ing } = await supabaseAdmin
        .from("ingredients")
        .select("id, canonical_id")
        .limit(1)
        .single();
    const { data: dishForm } = await supabaseAdmin
        .from("tags")
        .select("id, name")
        .eq("type", "dish_form")
        .limit(1)
        .single();

    // A catalogue recipe (created_by null) and an owned one belonging to B.
    const { data: cat } = await supabaseAdmin
        .from("recipes")
        .insert({ name: `ZZ Subs Catalogue ${stamp}` })
        .select("id")
        .single();
    const { data: owned } = await supabaseAdmin
        .from("recipes")
        .insert({ name: `ZZ Subs Owned ${stamp}`, created_by: b.profileId })
        .select("id")
        .single();

    await supabaseAdmin.from("recipe_tags").insert({ recipe_id: cat!.id, tag_id: dishForm!.id });

    const { data: catRi } = await supabaseAdmin
        .from("recipe_ingredients")
        .insert({ recipe_id: cat!.id, ingredient_id: ing!.id, quantity: 1, unit_id: unit!.id })
        .select("id")
        .single();
    const { data: ownedRi } = await supabaseAdmin
        .from("recipe_ingredients")
        .insert({ recipe_id: owned!.id, ingredient_id: ing!.id, quantity: 1, unit_id: unit!.id })
        .select("id")
        .single();

    const call = (client: SupabaseClient, riId: string, name: string, ratio?: string) =>
        client.rpc("record_ingredient_substitution", {
            p_recipe_ingredient_id: riId,
            p_substitute_name: name,
            ...(ratio ? { p_ratio: ratio } : {}),
        });

    try {
        // 1. unauthenticated
        const guest = await call(anon, catRi!.id, "olive oil");
        check("guest cannot record", !!guest.error, guest.error ? "" : "WROTE A ROW");

        // 2. owner records on a catalogue recipe
        const first = await call(a.client, catRi!.id, "Olive Oil", "1:1");
        check("A records a swap", !first.error, first.error?.message ?? "");
        const row = first.data as Record<string, unknown> | null;
        check("  canonicalises the substitute", row?.substitute_canonical_id === "olive_oil",
            String(row?.substitute_canonical_id));
        check("  keeps the name as offered", row?.substitute_name === "Olive Oil");
        check("  derives the replaced canonical id", row?.replaced_canonical_id === ing!.canonical_id);
        check("  snapshots the dish form", row?.dish_form === dishForm!.name, String(row?.dish_form));
        check("  stores the ratio", row?.ratio === "1:1");
        check("  attributes to the caller's profile", row?.profile_id === a.profileId);

        // 3. state, not events
        const second = await call(a.client, catRi!.id, "ghee");
        check("re-recording updates rather than appends", !second.error, second.error?.message ?? "");
        const { count } = await supabaseAdmin
            .from("profile_ingredient_substitutions")
            .select("id", { count: "exact", head: true })
            .eq("profile_id", a.profileId);
        check("  still one row for A", count === 1, `count=${count}`);
        check("  holds the newest choice",
            (second.data as Record<string, unknown>)?.substitute_canonical_id === "ghee");

        // 4. RLS
        const { data: bSees } = await b.client
            .from("profile_ingredient_substitutions")
            .select("id");
        check("B cannot read A's rows", (bSees ?? []).length === 0,
            (bSees ?? []).length > 0 ? "LEAK" : "");

        // 5. per-profile key
        const bRow = await call(b.client, catRi!.id, "butter");
        check("B records the same ingredient separately", !bRow.error, bRow.error?.message ?? "");
        const { count: total } = await supabaseAdmin
            .from("profile_ingredient_substitutions")
            .select("id", { count: "exact", head: true })
            .eq("recipe_ingredient_id", catRi!.id);
        check("  two rows for one recipe ingredient", total === 2, `count=${total}`);

        // 6. visibility
        const trespass = await call(a.client, ownedRi!.id, "olive oil");
        check("A cannot record against B's owned recipe", !!trespass.error,
            trespass.error ? "" : "WROTE A ROW");

        // 7. self-substitution
        const self = await call(a.client, catRi!.id, ing!.canonical_id.replace(/_/g, " "));
        check("a thing cannot replace itself", !!self.error, self.error ? "" : "WROTE A ROW");

        // 8. owner may forget
        const del = await a.client.from("profile_ingredient_substitutions").delete().eq("profile_id", a.profileId).select("id");
        check("A can delete its own row", (del.data ?? []).length === 1, del.error?.message ?? "");

        // 9. direct writes are revoked
        const direct = await a.client.from("profile_ingredient_substitutions").insert({
            profile_id: a.profileId,
            recipe_id: cat!.id,
            recipe_ingredient_id: catRi!.id,
            replaced_ingredient_id: ing!.id,
            replaced_canonical_id: ing!.canonical_id,
            substitute_name: "forged",
            substitute_canonical_id: "forged",
        });
        check("direct insert is refused", !!direct.error, direct.error ? "" : "FORGED A ROW");
    } finally {
        await supabaseAdmin.from("recipes").delete().in("id", [cat!.id, owned!.id]);
        await supabaseAdmin.auth.admin.deleteUser(a.id);
        await supabaseAdmin.auth.admin.deleteUser(b.id);
    }

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
