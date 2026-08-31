import { supabase, supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Proves `find_near_miss_recipes` refuses the dishes it must refuse.
 *
 * The near-miss rail's whole risk is that "one ingredient away" is a distance,
 * not a judgement. Bak Kut Teh is one ingredient from vegan and the ingredient
 * is the pork ribs; Apfelpfannkuchen is one from dairy-free and the ingredient
 * is the butter. The query cannot tell those apart, so `20260830000001` puts
 * four structural gates in front of it, and a rail that quietly loses one of
 * them does not error — it starts offering Vegetarian Bak Kut Teh, which reads
 * as the app not knowing what food is.
 *
 * So this builds a fixture for each gate and asserts the outcome, rather than
 * reading the function definition back. Every EXPECT-ABSENT case below is one
 * gate; delete any single predicate from the function and exactly one of them
 * flips.
 *
 * It also pins the two behaviours the rail's additivity rests on: a reader with
 * no dietary restrictions gets NOTHING (not "everything"), and a recipe already
 * satisfying the diet is not offered as one change away from itself.
 *
 * ## What it does NOT prove
 *
 * - **That the surviving suggestions are GOOD.** Only that the gutted ones are
 *   gone. Margherita Pizza / Mozzarella survives every gate here and is kept
 *   knowingly — see the migration header. Judging that pair needs the
 *   adaptation gate, not a fixture.
 * - **The counts on the real catalogue.** Those were measured against the dev
 *   project on 2026-08-30 (37 dishes over six diets; gluten-free, soy-free,
 *   vegetarian and pescatarian correctly produce none). A local stack has three
 *   recipes, so this asserts semantics and the measurement is a separate
 *   exercise.
 *
 * SAFE TO RUN ANY TIME. Writes a handful of `ZZ …` ingredients and recipes and
 * removes them in a finally block. No LLM, no spend.
 *
 *   npx nx run @fridgeezy/database:check-near-miss
 */

/**
 * Two prefixes, sharing no token, and that is load-bearing.
 *
 * Gate 2 asks whether the blocker's name appears in the DISH's name. A single
 * shared prefix makes that true of every fixture pair, so every positive case
 * is refused and every EXPECT-ABSENT assertion passes for the wrong reason —
 * which is exactly what happened the first time this ran. The positive controls
 * at the top are what caught it, and they are why they are there.
 */
const ING_PREFIX = "Zzning";
const RECIPE_PREFIX = "Zzndish";

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok) pass++;
    else fail++;
};

type Props = string[];

interface Fixture {
    ingredients: Map<string, string>;
    recipes: Map<string, string>;
    diets: Map<string, string>;
}

/**
 * One ingredient, with its classification stated outright.
 *
 * `classified` is separate from the property list because an EMPTY list and an
 * UNCLASSIFIED ingredient are different answers and the function treats them
 * differently — the first is "carries none of them", the second is "nobody has
 * checked". That distinction is the whole of case 7 below.
 */
async function makeIngredient(
    name: string,
    properties: Props,
    { classified = true, componentKind = null as string | null } = {}
): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .insert({
            name: `${ING_PREFIX} ${name}`,
            dietary_properties: properties as never,
            dietary_classified_at: classified ? new Date().toISOString() : null,
            component_kind: componentKind as never,
            // `ingredients_component_dish_check` binds the two together: a
            // `dish` component must name the dish it is, and anything else must
            // not. The fixture has to satisfy it or it is testing a row shape
            // the catalogue cannot hold.
            component_dish: componentKind === "dish" ? `${name} (test)` : null,
        })
        .select("id")
        .single();

    if (error) throw new Error(`ingredient "${name}": ${error.message}`);

    return data.id;
}

/**
 * A recipe, registered under its short label.
 *
 * The label is what the assertions read; the ID is what they match on. A
 * trigger title-cases `name` on the way in ("ZZ …" is stored as "Zz …"), so
 * anything keyed on the string we sent silently misses — which is also why the
 * cleanup below is `ilike` rather than `like`.
 */
async function makeRecipe(
    fixture: Fixture,
    label: string,
    ingredientIds: string[],
    { nameEn = null as string | null } = {}
): Promise<string> {
    // `recipe_ingredients` requires a quantity AND a unit. Neither is read by
    // the function under test, so any real unit will do — but the row has to be
    // one the catalogue could hold, or the fixture is not a fixture.
    const { data: unit, error: unitError } = await supabaseAdmin
        .from("units")
        .select("id")
        .limit(1)
        .maybeSingle();

    if (unitError) throw new Error(`units: ${unitError.message}`);
    if (!unit) throw new Error("no unit rows — run the seeds first");

    const { data, error } = await supabaseAdmin
        .from("recipes")
        .insert({ name: `${RECIPE_PREFIX} ${label}`, name_en: nameEn })
        .select("id")
        .single();

    if (error) throw new Error(`recipe "${label}": ${error.message}`);

    const rows = ingredientIds.map((ingredient_id) => ({
        recipe_id: data.id,
        ingredient_id,
        quantity: 1,
        unit_id: unit.id,
    }));

    const { error: linkError } = await supabaseAdmin
        .from("recipe_ingredients")
        .insert(rows);

    if (linkError) {
        throw new Error(`recipe "${label}" links: ${linkError.message}`);
    }

    fixture.recipes.set(label, data.id);

    return data.id;
}

interface RailRow {
    blocker: string;
    diets: string[];
}

/** The rail, as the function actually answers it, keyed by recipe id. */
async function rail(
    dietCanonicalIds: string[],
    fixture: Fixture,
    extra: Record<string, unknown> = {}
): Promise<Map<string, RailRow>> {
    const { data, error } = await supabaseAdmin.rpc("find_near_miss_recipes", {
        p_diets: dietCanonicalIds.map((id) => {
            const tag = fixture.diets.get(id);
            if (!tag) throw new Error(`no dietary tag for "${id}"`);
            return tag;
        }),
        p_limit: 100,
        ...extra,
    } as never);

    if (error) throw new Error(`find_near_miss_recipes: ${error.message}`);

    return new Map(
        ((data ?? []) as Array<{
            id: string;
            blocker_name: string;
            blocked_diets: string[];
        }>).map((row) => [
            row.id,
            { blocker: row.blocker_name, diets: row.blocked_diets ?? [] },
        ])
    );
}

const rowFor = (
    result: Map<string, RailRow>,
    fixture: Fixture,
    label: string
): RailRow | undefined => {
    const id = fixture.recipes.get(label);
    if (!id) throw new Error(`no fixture recipe "${label}"`);
    return result.get(id);
};

async function main() {
    const fixture: Fixture = {
        ingredients: new Map(),
        recipes: new Map(),
        diets: new Map(),
    };

    const { data: dietTags, error: dietError } = await supabaseAdmin
        .from("tags")
        .select("id, canonical_id")
        .eq("type", "dietary");

    if (dietError) throw new Error(dietError.message);

    for (const tag of dietTags ?? []) {
        fixture.diets.set(tag.canonical_id, tag.id);
    }

    try {
        // ---- ingredients ----
        const filler = await makeIngredient("Onion", []);
        const butter = await makeIngredient("Butter", ["dairy"]);
        const cream = await makeIngredient("Cream", ["dairy"]);
        const egg = await makeIngredient("Egg", ["egg"]);
        const porkRib = await makeIngredient("Pork Rib", ["meat"]);
        const soySauce = await makeIngredient("Soy Sauce", [
            "gluten",
            "soy",
            "grain",
        ]);
        const mystery = await makeIngredient("Mystery Spice", [], {
            classified: false,
        });
        const custard = await makeIngredient("Custard Base", ["dairy", "egg"], {
            componentKind: "dish",
        });

        for (const [name, id] of [
            ["Onion", filler],
            ["Butter", butter],
            ["Cream", cream],
            ["Egg", egg],
            ["Pork Rib", porkRib],
            ["Soy Sauce", soySauce],
            ["Mystery Spice", mystery],
            ["Custard Base", custard],
        ] as const) {
            fixture.ingredients.set(name, id);
        }

        // ---- recipes ----
        const pancake = await makeRecipe(fixture, "Pancake", [filler, butter]);
        await makeRecipe(fixture, "Butter Sauce", [filler, butter]);
        await makeRecipe(fixture, "Blanc", [filler, butter], {
            // The Beurre Blanc case: the native name shares no token with the
            // blocker and the ENGLISH name gives it away.
            nameEn: "French Butter Sauce",
        });
        await makeRecipe(fixture, "Rib Soup", [filler, porkRib]);
        await makeRecipe(fixture, "Plain Salad", [filler]);
        await makeRecipe(fixture, "Double Dairy", [filler, butter, cream]);
        await makeRecipe(fixture, "Unknown Extra", [filler, butter, mystery]);
        await makeRecipe(fixture, "Single Unknown", [filler, mystery]);
        await makeRecipe(fixture, "Noodles", [filler, soySauce]);
        await makeRecipe(fixture, "Trifle", [filler, custard]);
        // Neither label may contain a token of its own blocker's name, or gate
        // 2 refuses it and the union assertions below pass vacuously. "Egg Wash
        // Bun" and "Buttered Bun" were the first attempt and did exactly that.
        await makeRecipe(fixture, "Glazed Bun", [filler, egg]);
        // Blocked ONCE by dairy and ONCE by egg — distance one for either diet
        // alone and distance two for the pair. The union case.
        await makeRecipe(fixture, "Rich Bun", [filler, butter, egg]);

        const present = (
            result: Map<string, RailRow>,
            label: string
        ): boolean => !!rowFor(result, fixture, label);

        // ------------------------------------------------------------------
        console.log("\nThe control, and the two shapes the rail must not take:");

        const dairy = await rail(["dairy_free"], fixture);
        const offered = rowFor(dairy, fixture, "Pancake");
        check(
            "a genuine near miss is offered, with the blocker named",
            !!offered && /butter/i.test(offered.blocker),
            offered?.blocker ?? "absent"
        );

        const none = await rail([], fixture);
        check(
            "no dietary restriction returns NOTHING, not everything",
            none.size === 0,
            none.size > 0 ? `${none.size} rows` : ""
        );

        check(
            "a dish that already suits the diet is not offered",
            !present(dairy, "Plain Salad")
        );

        // ------------------------------------------------------------------
        console.log("\nThe four gates, one fixture each:");

        check(
            "gate 1 — a protagonist property (meat) is never swappable",
            !present(await rail(["vegan"], fixture), "Rib Soup"),
            "Bak Kut Teh minus the pork ribs"
        );

        check(
            "gate 1 — a mixed blocker fails on any one property (soy sauce)",
            !present(await rail(["gluten_free"], fixture), "Noodles"),
            "gluten + soy + grain is not a subset of the swappable six"
        );

        check(
            "gate 2 — a blocker named in the dish's own title is refused",
            !present(dairy, "Butter Sauce")
        );

        check(
            "gate 2 — ...including when only the ENGLISH name gives it away",
            !present(dairy, "Blanc"),
            "the Beurre Blanc case"
        );

        check(
            "gate 3 — an ingredient that is itself a dish is a protagonist",
            !present(dairy, "Trifle"),
            "component_kind = 'dish'"
        );

        check(
            "gate 4 — an unclassified blocker is never NAMED as the swap",
            !present(dairy, "Single Unknown"),
            "nobody has checked it"
        );

        check(
            "gate 4 — ...and it still counts toward the distance",
            !present(dairy, "Unknown Extra"),
            "butter + something unchecked is two changes, not one"
        );

        // ------------------------------------------------------------------
        console.log("\nDistance is over the UNION of the requested diets:");

        check(
            "two blockers for one diet is distance two",
            !present(dairy, "Double Dairy")
        );

        check(
            "one blocker for either diet alone is distance one",
            present(dairy, "Rich Bun") &&
                present(await rail(["egg_free"], fixture), "Rich Bun")
        );

        const both = await rail(["dairy_free", "egg_free"], fixture);
        check(
            "a dish with one blocker across BOTH diets is still offered",
            present(both, "Pancake") && present(both, "Glazed Bun"),
            "butter offends dairy-free only; the egg wash offends egg-free only"
        );
        check(
            "...but one blocker for EACH is two changes, and is refused",
            !present(both, "Rich Bun"),
            "butter and egg — swapping either still leaves the other"
        );

        const veganEgg = await rail(["vegan", "egg_free"], fixture);
        const eggBun = rowFor(veganEgg, fixture, "Glazed Bun");
        check(
            "blocked_diets names every diet the one blocker offends",
            JSON.stringify(eggBun?.diets ?? []) ===
                JSON.stringify(["egg_free", "vegan"]),
            JSON.stringify(eggBun?.diets ?? [])
        );

        // ------------------------------------------------------------------
        console.log("\nThe filters it shares with find_recipes:");

        const blacklisted = await rail(["dairy_free"], fixture, {
            p_blacklist: [filler],
        });
        check(
            "a blacklisted ingredient removes the dish",
            !blacklisted.has(pancake)
        );

        const excluded = await rail(["dairy_free"], fixture, {
            p_exclude: [pancake],
        });
        check(
            "p_exclude keeps a dish already on screen out of the rail",
            !excluded.has(pancake)
        );

        const wrongIngredient = await rail(["dairy_free"], fixture, {
            p_ingredients: [porkRib],
        });
        check(
            "an ingredient filter narrows the rail the same way",
            !wrongIngredient.has(pancake)
        );

        // ------------------------------------------------------------------
        console.log("\nVisibility (SECURITY INVOKER — RLS is the mechanism):");

        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .limit(1)
            .maybeSingle();

        if (!profile) {
            console.log("  – no profile row; skipping the ownership assertion");
        } else {
            const { data: owned } = await supabaseAdmin
                .from("recipes")
                .insert({
                    name: `${RECIPE_PREFIX} Owned Pancake`,
                    created_by: profile.id,
                })
                .select("id")
                .single();

            if (owned) {
                await supabaseAdmin.from("recipe_ingredients").insert([
                    { recipe_id: owned.id, ingredient_id: filler },
                    { recipe_id: owned.id, ingredient_id: butter },
                ]);

                const dairyFree = fixture.diets.get("dairy_free");

                if (!dairyFree) {
                    throw new Error("no dairy_free tag — run the seeds first");
                }

                const { data: asGuest, error: guestError } = await supabase.rpc(
                    "find_near_miss_recipes",
                    { p_diets: [dairyFree], p_limit: 500 } as never
                );

                if (guestError) {
                    check(
                        "the function is callable as a guest",
                        false,
                        guestError.message
                    );
                } else {
                    check(
                        "a guest can call it at all",
                        true,
                        `${(asGuest ?? []).length} rows`
                    );
                    const leaked = ((asGuest ?? []) as Array<{ id: string }>)
                        .some((row) => row.id === owned.id);
                    check(
                        "someone else's imported recipe never reaches the rail",
                        !leaked,
                        leaked ? "LEAK" : ""
                    );
                }
            }
        }
    } finally {
        // Ingredients last: recipe_ingredients references them.
        // `ilike`, not `like`: a trigger title-cases the name on insert, so the
        // string we sent is not the string stored, and a case-sensitive match
        // leaves the whole fixture behind — which then collides on
        // `ingredients_canonical_id_key` the next time this runs.
        await supabaseAdmin
            .from("recipes")
            .delete()
            .ilike("name", `${RECIPE_PREFIX}%`);
        await supabaseAdmin
            .from("ingredients")
            .delete()
            .ilike("name", `${ING_PREFIX}%`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
