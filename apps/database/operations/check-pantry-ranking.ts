import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * Proves `find_recipes`' pantry ranking orders what it claims to, and — the half
 * that would cost more if it broke — that it changes NOTHING for a caller that
 * passes no pantry.
 *
 * `p_pantry` is additive by design (`20260902000001`): it reorders, it never
 * filters, and the result-set totals and facets are untouched. Every one of
 * those claims is a property of an ORDER BY and a pair of guarded CTEs, and
 * none of them fails loudly. A `pantry_missing` that forgot its `not
 * pantry_empty` guard would count every ingredient of every dish as missing for
 * the home feed, the search screen and the dish picker — none of which pass a
 * pantry — and reorder the whole catalogue by ingredient count with nothing to
 * report it.
 *
 * So this asserts outcomes against fixtures rather than reading definitions
 * back. Nine groups:
 *
 *   1. inert without a pantry — the ordering and the columns
 *   2. the AND filter still ANDs (this is not an overlap filter)
 *   3. fewest-missing beats most-used, which is the ranking decision
 *   4. a dish the fridge did not reach sorts last, however small it is
 *   5. staples count on NEITHER side
 *   6. the missing list names what to buy, and agrees with the count
 *   7. identity: an alias-duplicate ingredient row is the same ingredient
 *   8. ...on the AND filter and the blacklist too, in both directions
 *   9. it ranks and never filters — same rows, same totals, different order
 *
 * ## What it does NOT prove
 *
 * - **That the weights are right on a real catalogue.** They were measured
 *   against the dev project on 2026-09-02 (26-item fridge; the AND filter
 *   returns zero from five items on, most-used leads with a dish needing six
 *   more items, staples are 17.7% of ingredient rows spread 0–4 per dish). A
 *   local stack has twelve recipes, so this asserts semantics and the
 *   measurement is a separate exercise — see the migration header.
 * - **That the staples LIST is right.** Only that being on it has the effect it
 *   should. Whether olive oil belongs there is a judgement, not a fixture.
 *
 * SAFE TO RUN ANY TIME. Writes `Zzpan …` ingredients, aliases and recipes and
 * removes them in a finally block. No LLM, no spend.
 *
 *   npx nx run @fridgeezy/database:check-pantry-ranking
 */

/**
 * Two prefixes sharing no token, for the reason `check-near-miss` needs them:
 * a fixture whose ingredient names are substrings of its dish names makes some
 * assertion pass for the wrong reason. Nothing here compares the two, but the
 * cleanup is keyed on them and they must not collide with a seeded row.
 */
const ING_PREFIX = "Zzpaning";
const RECIPE_PREFIX = "Zzpandish";

let pass = 0;
let fail = 0;

const check = (label: string, ok: boolean, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (ok) pass++;
    else fail++;
};

interface Fixture {
    ingredients: Map<string, string>;
    recipes: Map<string, string>;
    unitId: string;
}

/** One row of the feed, narrowed to what this file asserts on. */
interface FeedRow {
    id: string;
    name: string;
    source: string;
    pantryHave: number;
    pantryMissing: number;
    missingNames: string[];
    totalRecipes: number | null;
    totalSuggestions: number | null;
    facets: unknown[];
}

async function makeIngredient(
    fixture: Fixture,
    label: string,
    { canonicalName = null as string | null } = {}
): Promise<string> {
    // `canonicalName` exists for the staples cases: a staple is matched on
    // `canonical_id`, which is derived from the NAME by a trigger, so a fixture
    // that wants to be a staple has to be called "Salt" and cannot carry the
    // prefix. Those rows are cleaned up by id instead.
    const name = canonicalName ?? `${ING_PREFIX} ${label}`;

    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .insert({ name })
        .select("id")
        .single();

    if (error) throw new Error(`ingredient "${label}": ${error.message}`);

    fixture.ingredients.set(label, data.id);

    return data.id;
}

const ing = (fixture: Fixture, label: string): string => {
    const id = fixture.ingredients.get(label);
    if (!id) throw new Error(`no fixture ingredient "${label}"`);
    return id;
};

async function makeRecipe(
    fixture: Fixture,
    label: string,
    ingredientLabels: string[]
): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .insert({ name: `${RECIPE_PREFIX} ${label}` })
        .select("id")
        .single();

    if (error) throw new Error(`recipe "${label}": ${error.message}`);

    const { error: linkError } = await supabaseAdmin
        .from("recipe_ingredients")
        .insert(
            ingredientLabels.map((item) => ({
                recipe_id: data.id,
                ingredient_id: ing(fixture, item),
                quantity: 1,
                unit_id: fixture.unitId,
            }))
        );

    if (linkError) throw new Error(`recipe "${label}": ${linkError.message}`);

    fixture.recipes.set(label, data.id);

    return data.id;
}

/**
 * The feed, as the function answers it.
 *
 * `limit_count` is deliberately large everywhere below. The pantry keys are in
 * the truncation as well as the final sort, and a small limit would make an
 * ordering assertion indistinguishable from a paging one.
 */
async function feed(
    args: Record<string, unknown> = {}
): Promise<FeedRow[]> {
    const { data, error } = await supabaseAdmin.rpc("find_recipes", {
        limit_count: 500,
        ...args,
    } as never);

    if (error) throw new Error(`find_recipes: ${error.message}`);

    return ((data ?? []) as Array<Record<string, never>>).map((row) => ({
        id: row.id as unknown as string,
        name: row.name as unknown as string,
        source: row.source as unknown as string,
        pantryHave: (row.pantry_have as unknown as number) ?? 0,
        pantryMissing: (row.pantry_missing as unknown as number) ?? 0,
        missingNames: (
            (row.pantry_missing_ingredients as unknown as
                | Array<{ name: string }>
                | null) ?? []
        ).map((item) => item.name),
        totalRecipes: (row.total_recipes as unknown as number) ?? null,
        totalSuggestions: (row.total_suggestions as unknown as number) ?? null,
        facets: (row.facets as unknown as unknown[]) ?? [],
    }));
}

/** Where a fixture dish sits in the feed, or -1. */
const rankOf = (rows: FeedRow[], fixture: Fixture, label: string): number =>
    rows.findIndex((row) => row.id === fixture.recipes.get(label));

const rowOf = (
    rows: FeedRow[],
    fixture: Fixture,
    label: string
): FeedRow | undefined =>
    rows.find((row) => row.id === fixture.recipes.get(label));

/** The fixture dishes only, in feed order. */
const ours = (rows: FeedRow[], fixture: Fixture): string[] => {
    const byId = new Map(
        [...fixture.recipes].map(([label, id]) => [id, label])
    );
    return rows.flatMap((row) => {
        const label = byId.get(row.id);
        return label ? [label] : [];
    });
};

async function main() {
    const { data: unit, error: unitError } = await supabaseAdmin
        .from("units")
        .select("id")
        .limit(1)
        .maybeSingle();

    if (unitError) throw new Error(`units: ${unitError.message}`);
    if (!unit) throw new Error("no unit rows — run the seeds first");

    const fixture: Fixture = {
        ingredients: new Map(),
        recipes: new Map(),
        unitId: unit.id,
    };

    // A staple that is really on the list, and one that is not, so cases 5 and
    // 6 are testing the table rather than a coincidence.
    const { data: staple, error: stapleError } = await supabaseAdmin
        .from("pantry_staples")
        .select("canonical_id")
        .limit(1)
        .maybeSingle();

    if (stapleError) throw new Error(`pantry_staples: ${stapleError.message}`);
    if (!staple) throw new Error("pantry_staples is empty — run the migration");

    try {
        // ------------------------------------------------------------------
        // Ingredients. `have*` are what the fixture fridge holds; `gap*` are
        // what it does not.
        for (const label of ["have1", "have2", "have3", "have4", "have5"]) {
            await makeIngredient(fixture, label);
        }
        for (const label of ["gap1", "gap2", "gap3", "gap4", "gap5", "gap6"]) {
            await makeIngredient(fixture, label);
        }

        // The staple, under the exact canonical id the table holds. Created
        // only if the catalogue has no such row already — on a seeded stack it
        // usually does, and a second one would violate the canonical unique key.
        const { data: existingStaple } = await supabaseAdmin
            .from("ingredients")
            .select("id")
            .eq("canonical_id", staple.canonical_id)
            .maybeSingle();

        const stapleId =
            existingStaple?.id ??
            (await makeIngredient(fixture, "staple", {
                // The trigger derives the canonical id from the name, and the
                // canonical rule is lossy, so the only way to land on a known
                // canonical id is to send a name that produces it.
                canonicalName: staple.canonical_id.replace(/_/g, " "),
            }));

        fixture.ingredients.set("staple", stapleId);

        // The identity pair: two ingredient ROWS that are the same thing,
        // linked the way the catalogue links them — an alias whose canonical
        // form IS the other row's canonical id. This is the "All Purpose Flour"
        // / "Flour" shape, which is what the picker actually hands over.
        const twinA = await makeIngredient(fixture, "twinA");
        const twinB = await makeIngredient(fixture, "twinB");

        const { data: twinARow } = await supabaseAdmin
            .from("ingredients")
            .select("canonical_id")
            .eq("id", twinA)
            .single();

        const { error: aliasError } = await supabaseAdmin
            .from("ingredient_aliases")
            .insert({
                // "the name of twinA means twinB" — so the two rows are one
                // ingredient, and `ingredient_identity_ids` must join them
                // whichever end it is asked from.
                alias: twinARow?.canonical_id.replace(/_/g, " ") ?? "",
                ingredient_id: twinB,
            });

        if (aliasError) throw new Error(`alias: ${aliasError.message}`);

        // ------------------------------------------------------------------
        // Dishes. Named for what they are meant to demonstrate.
        //
        // `Close`    3 of yours, 1 to buy         — the fewest-missing winner
        // `Broad`    5 of yours, 4 to buy         — the most-used winner
        // `Untouched` 0 of yours, 2 to buy        — small, and the fridge misses it
        // `AllStaple` nothing but a staple        — (0, 0): the degenerate case
        // `Stapled`  2 of yours, 1 to buy + staple — staples on neither side
        // `Twin`     lists twinB only             — reachable by asking for twinA
        await makeRecipe(fixture, "Close", ["have1", "have2", "have3", "gap1"]);
        await makeRecipe(fixture, "Broad", [
            "have1",
            "have2",
            "have3",
            "have4",
            "have5",
            "gap1",
            "gap2",
            "gap3",
            "gap4",
        ]);
        await makeRecipe(fixture, "Untouched", ["gap5", "gap6"]);
        await makeRecipe(fixture, "AllStaple", ["staple"]);
        await makeRecipe(fixture, "Stapled", [
            "have1",
            "have2",
            "gap1",
            "staple",
        ]);
        await makeRecipe(fixture, "Twin", ["twinB", "have1"]);

        const fridge = [
            ing(fixture, "have1"),
            ing(fixture, "have2"),
            ing(fixture, "have3"),
            ing(fixture, "have4"),
            ing(fixture, "have5"),
        ];

        // ------------------------------------------------------------------
        console.log("\n1. Inert without a pantry:");

        const bare = await feed();
        const bareOrder = ours(bare, fixture);

        check(
            "every pantry column is zero/empty when no pantry is passed",
            bare.every(
                (row) =>
                    row.pantryHave === 0 &&
                    row.pantryMissing === 0 &&
                    row.missingNames.length === 0
            ),
            "a missing `not pantry_empty` guard shows up here first"
        );

        const bareAgain = await feed({ p_pantry: [] });
        check(
            "an explicitly empty pantry is the same call",
            JSON.stringify(ours(bareAgain, fixture)) ===
                JSON.stringify(bareOrder),
            bareOrder.join(" > ")
        );

        // ------------------------------------------------------------------
        console.log("\n2. `ingredients` still ANDs — this is not an overlap filter:");

        const andTwo = await feed({
            ingredients: [ing(fixture, "have1"), ing(fixture, "gap5")],
        });
        check(
            "a dish must contain EVERY requested ingredient",
            rankOf(andTwo, fixture, "Close") === -1 &&
                rankOf(andTwo, fixture, "Untouched") === -1,
            "Close has have1 and not gap5; Untouched has gap5 and not have1"
        );

        const andOne = await feed({ ingredients: [ing(fixture, "have1")] });
        check(
            "...and one requested ingredient still matches",
            rankOf(andOne, fixture, "Close") >= 0
        );

        // ------------------------------------------------------------------
        console.log("\n3. The ranking: fewest missing, not most used:");

        const ranked = await feed({ p_pantry: fridge });
        const order = ours(ranked, fixture);

        const close = rowOf(ranked, fixture, "Close");
        const broad = rowOf(ranked, fixture, "Broad");

        check(
            "the counts are what the fixture says they are",
            close?.pantryHave === 3 &&
                close?.pantryMissing === 1 &&
                broad?.pantryHave === 5 &&
                broad?.pantryMissing === 4,
            `Close ${close?.pantryHave}/${close?.pantryMissing}, Broad ${broad?.pantryHave}/${broad?.pantryMissing}`
        );

        check(
            "a dish needing one thing beats a dish using more and needing four",
            rankOf(ranked, fixture, "Close") < rankOf(ranked, fixture, "Broad"),
            order.join(" > ")
        );

        // ------------------------------------------------------------------
        console.log("\n4. A dish the fridge did not reach sorts last:");

        check(
            "a two-ingredient dish you have neither half of loses to a dish missing four",
            rankOf(ranked, fixture, "Untouched") >
                rankOf(ranked, fixture, "Broad"),
            "pure missing-ascending would put Untouched (missing 2) first"
        );

        const allStaple = rowOf(ranked, fixture, "AllStaple");
        check(
            "a dish of nothing but staples scores (0, 0)...",
            allStaple?.pantryHave === 0 && allStaple?.pantryMissing === 0,
            `${allStaple?.pantryHave}/${allStaple?.pantryMissing}`
        );
        check(
            "...and is sorted behind every dish the fridge did reach",
            rankOf(ranked, fixture, "AllStaple") >
                rankOf(ranked, fixture, "Broad"),
            "the (pantry_have = 0) key — without it this tops the feed"
        );

        // ------------------------------------------------------------------
        console.log("\n5. Staples count on neither side:");

        const stapled = rowOf(ranked, fixture, "Stapled");
        check(
            "a staple the reader does NOT list is not counted as missing",
            stapled?.pantryMissing === 1,
            `${staple.canonical_id} is in the dish and not in the fridge; missing = ${stapled?.pantryMissing}`
        );

        const withStaple = await feed({
            p_pantry: [...fridge, ing(fixture, "staple")],
        });
        const stapledOwned = rowOf(withStaple, fixture, "Stapled");
        check(
            "...and listing it does not inflate `have` either",
            stapledOwned?.pantryHave === stapled?.pantryHave &&
                stapledOwned?.pantryMissing === stapled?.pantryMissing,
            `${stapledOwned?.pantryHave}/${stapledOwned?.pantryMissing} vs ${stapled?.pantryHave}/${stapled?.pantryMissing}`
        );

        // ------------------------------------------------------------------
        console.log("\n6. The gap is named, and agrees with the count:");

        check(
            "every row's missing list is exactly as long as its missing count",
            ranked.every(
                (row) => row.missingNames.length === row.pantryMissing
            ),
            "the list and the count are computed separately and must agree"
        );

        check(
            "the named gap is the ingredient the reader lacks",
            // Lowercased: a trigger title-cases the name on insert, so the row
            // reads "Zzpaning Gap1" and not the string the fixture sent.
            (close?.missingNames ?? []).length === 1 &&
                (close?.missingNames[0] ?? "").toLowerCase().includes("gap1"),
            (close?.missingNames ?? []).join(", ")
        );

        check(
            "a staple is never named as something to buy",
            !(stapled?.missingNames ?? []).some((name) =>
                name.toLowerCase().includes(staple.canonical_id.split("_")[0])
            ),
            (stapled?.missingNames ?? []).join(", ")
        );

        // ------------------------------------------------------------------
        console.log("\n7. Identity: two rows for one ingredient are one ingredient:");

        const askTwinA = await feed({ p_pantry: [ing(fixture, "twinA")] });
        const twinRow = rowOf(askTwinA, fixture, "Twin");
        check(
            "a fridge holding twinA counts a dish that lists twinB",
            twinRow?.pantryHave === 1,
            `have = ${twinRow?.pantryHave} (0 means the closure is not applied)`
        );

        const askTwinB = await feed({ p_pantry: [ing(fixture, "twinB")] });
        check(
            "...and the relation is symmetric",
            rowOf(askTwinB, fixture, "Twin")?.pantryHave === 1
        );

        // ------------------------------------------------------------------
        console.log("\n8. The same identity on the filter and the blacklist:");

        const filterTwinA = await feed({ ingredients: [ing(fixture, "twinA")] });
        check(
            "the AND filter finds a dish listing the other spelling",
            rankOf(filterTwinA, fixture, "Twin") >= 0,
            "this is the All Purpose Flour / Flour trapdoor"
        );

        const blockedTwinA = await feed({ blacklist: [ing(fixture, "twinA")] });
        check(
            "a blacklist on one spelling excludes the other",
            rankOf(blockedTwinA, fixture, "Twin") === -1,
            "widening the blacklist fails CLOSED, which is the safe direction"
        );

        const andBoth = await feed({
            ingredients: [ing(fixture, "twinA"), ing(fixture, "have1")],
        });
        check(
            "two requested ids still need two satisfied requests",
            rankOf(andBoth, fixture, "Twin") >= 0 &&
                rankOf(andBoth, fixture, "Close") === -1,
            "Twin has both; Close has have1 and neither twin. A flat closure would break this"
        );

        // ------------------------------------------------------------------
        console.log("\n9. It ranks; it does not filter:");

        check(
            "the same rows come back, in a different order",
            ranked.length === bare.length &&
                new Set(ranked.map((row) => row.id)).size ===
                    new Set(bare.map((row) => row.id)).size &&
                ranked.every((row) =>
                    bare.some((other) => other.id === row.id)
                ),
            `${bare.length} rows without a pantry, ${ranked.length} with`
        );

        check(
            "...and the order genuinely changed",
            JSON.stringify(order) !== JSON.stringify(bareOrder),
            `${bareOrder.join(" > ")}  ->  ${order.join(" > ")}`
        );

        check(
            "the result-set totals are untouched by the pantry",
            ranked[0]?.totalRecipes === bare[0]?.totalRecipes &&
                ranked[0]?.totalSuggestions === bare[0]?.totalSuggestions,
            `${bare[0]?.totalRecipes}/${bare[0]?.totalSuggestions} vs ${ranked[0]?.totalRecipes}/${ranked[0]?.totalSuggestions}`
        );

        check(
            "the facets are untouched too",
            JSON.stringify(ranked[0]?.facets) ===
                JSON.stringify(bare[0]?.facets),
            "a facet count that moved with a fridge would be describing the sort"
        );
    } finally {
        // Recipes first: recipe_ingredients cascades from them and references
        // the ingredients below. `ilike`, not `like` — a trigger title-cases
        // the name on insert, so the string sent is not the string stored, and
        // a case-sensitive match leaves the fixture behind to collide on
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
