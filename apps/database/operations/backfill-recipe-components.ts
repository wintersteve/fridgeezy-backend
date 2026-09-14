import { generateCompletion } from "@fridgeezy/llm";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { canonicalizeName } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Declare which COMPONENTS each existing dish is built on, so "give me a recipe
 * with béchamel" can be answered from the catalogue instead of generated.
 *
 * The companion to `20260913000003`. New dishes declare their own components as
 * they are written; this is the repair for everything already stored.
 *
 * ## Why this needs a model at all, and what stops it inventing
 *
 * The honest position first: **the deterministic evidence does not exist.**
 * Recipes decompose their components — Moussaka lists Unsalted Butter, Flour,
 * Whole Milk and Nutmeg, never a béchamel — and nothing in the schema records
 * what a béchamel is MADE of. The component's own recipe would say, but
 * measured on both databases 2026-09-13, none of the four classified components
 * has a catalogue row under its `component_dish_canonical_id` (the ingredient
 * `Béchamel Sauce` points at a dish called `Béchamel`; the local recipe is
 * called `Béchamel Sauce`, so they do not meet). A purely structural backfill
 * would therefore claim NOTHING, which is not a safe default so much as a
 * useless one.
 *
 * So a model proposes, and four structural gates decide — none of which the
 * model can talk its way past:
 *
 * 1. **The component must already exist**, as an ingredient row classified
 *    `component_kind = 'dish'`. The model picks from a closed list; it cannot
 *    name a component into being. This is the gate that makes the whole thing
 *    bounded, and it is why `classify-ingredient-component` is a prerequisite.
 * 2. **A dish is never its own component.** Compared on canonical id against
 *    both the dish name and the component's `component_dish` — a béchamel does
 *    not use a béchamel, and a Tomato Sauce recipe does not use Tomato Sauce.
 * 3. **The claim must be GROUNDED in the dish's own ingredient list.** The model
 *    has to name which of the ingredients ALREADY ON the dish it believes
 *    constitute the component, and every name it gives is checked against that
 *    list by canonical id. An ingredient it invents is dropped. This is the same
 *    construction the authenticity gate uses for `adaptation` — name the
 *    defining ingredient, then find it in the list — and it is what turns
 *    "moussaka has a béchamel" from an opinion into a check.
 * 4. **At least two grounded ingredients.** One coincidence is not evidence:
 *    almost every savoury dish has butter. A béchamel needs its roux AND its
 *    milk to be present before the claim stands.
 *
 * A claim failing any gate is REPORTED and dropped, never written. That is the
 * whole answer to "a component line must not be invented where the dish does not
 * use one": the dish's own ingredients are the evidence, and a claim they do not
 * support does not survive.
 *
 * ## Cost
 *
 * One `gpt-4.1-mini` call per dish, prompt ≈ the dish's ingredient list plus the
 * component vocabulary (~350 tokens in, ~80 out). At Sept 2026 pricing that is
 * roughly **$0.0002 per dish** — about 2 cents per hundred dishes, and the dev
 * catalogue (9 recipes + 15 suggestions locally, 9 + 15 remotely) costs well
 * under a cent to sweep. It is bounded by the catalogue, not by traffic, and
 * `COMPONENTS_LIMIT` caps a run.
 *
 * Dishes that already declare a component, or that already LIST one as an
 * ingredient (the implicit half of `dish_components`), are skipped — so a
 * re-run costs only the dishes it has not settled. `COMPONENTS_RECLASSIFY=true`
 * re-asks anyway.
 *
 * ## DRY RUN unless `COMPONENTS_APPLY=true`
 *
 * Read the dry run. It writes to rows people have saved and cooked from, and the
 * failure that matters is a FALSE claim — "this lasagne is built on a béchamel"
 * is invisible when right and discredits the feature when wrong, the same
 * asymmetry `classify-ingredient-component`'s own prompt leans against.
 */
const APPLY = process.env.COMPONENTS_APPLY === "true";
const RECLASSIFY = process.env.COMPONENTS_RECLASSIFY === "true";
const LIMIT = Number(process.env.COMPONENTS_LIMIT ?? 0);
const ONLY = process.env.COMPONENTS_ONLY?.toLowerCase();

/** The minimum number of the dish's OWN ingredients a claim must rest on. */
const MIN_GROUNDING = 2;

interface Component {
    id: string;
    name: string;
    dish: string;
    dishCanonicalId: string | null;
}

interface Dish {
    id: string;
    name: string;
    canonicalId: string;
    source: "recipe" | "suggestion";
    ingredients: Array<{ id: string; name: string }>;
}

interface Claim {
    component: string;
    grounded_in: string[];
}

const SYSTEM_PROMPT = `You decide which COMPONENTS a dish is built on.

A component is a sub-preparation with a name of its own — a béchamel, a pizza dough, a stock, a curry paste — that a cook makes separately and then uses. You will be given a CLOSED LIST of components. Never name anything outside it.

For each component the dish is genuinely built on, you must also name which of the dish's OWN listed ingredients make up that component. Copy those names EXACTLY as they appear in the dish's ingredient list.

Rules:
- Only claim a component when the dish's ingredient list actually contains what that component is made of. A moussaka listing butter, flour, milk and nutmeg IS built on a béchamel. A dish with none of those is not, whatever its reputation.
- A dish is never built on itself. A béchamel recipe does not use a béchamel.
- If the dish lists the component directly as an ingredient, do NOT claim it — that is already recorded.
- Claim nothing when nothing fits. An empty list is the common and correct answer.

Output EXACTLY this JSON and nothing else:
{"components":[{"component":"<exact name from the list>","grounded_in":["<exact ingredient name>", "..."]}]}`;

async function loadComponents(): Promise<Component[]> {
    const { data, error } = await supabaseAdmin
        .from("ingredients")
        .select("id, name, component_dish, component_dish_canonical_id")
        .eq("component_kind", "dish");

    if (error || !data) {
        console.error(`Failed to read components: ${error?.message}`);
        process.exit(1);
    }

    return (
        data as Array<{
            id: string;
            name: string;
            component_dish: string | null;
            component_dish_canonical_id: string | null;
        }>
    ).map((row) => ({
        id: row.id,
        name: row.name,
        dish: row.component_dish ?? row.name,
        dishCanonicalId: row.component_dish_canonical_id,
    }));
}

async function loadDishes(): Promise<Dish[]> {
    const dishes: Dish[] = [];

    const { data: recipes } = await supabaseAdmin
        .from("recipes")
        .select(
            "id, name, canonical_id, created_by, recipe_ingredients(ingredient_id, ingredients(id, name))"
        )
        .is("created_by", null);

    for (const row of (recipes ?? []) as never[]) {
        const r = row as {
            id: string;
            name: string;
            canonical_id: string;
            recipe_ingredients: Array<{ ingredients: { id: string; name: string } | null }>;
        };

        dishes.push({
            id: r.id,
            name: r.name,
            canonicalId: r.canonical_id,
            source: "recipe",
            ingredients: r.recipe_ingredients
                .map((ri) => ri.ingredients)
                .filter((i): i is { id: string; name: string } => !!i),
        });
    }

    const { data: suggestions } = await supabaseAdmin
        .from("recipe_suggestions")
        .select(
            "id, name, canonical_id, recipe_suggestion_ingredients(ingredient_id, ingredients(id, name))"
        );

    for (const row of (suggestions ?? []) as never[]) {
        const s = row as {
            id: string;
            name: string;
            canonical_id: string;
            recipe_suggestion_ingredients: Array<{
                ingredients: { id: string; name: string } | null;
            }>;
        };

        dishes.push({
            id: s.id,
            name: s.name,
            canonicalId: s.canonical_id,
            source: "suggestion",
            ingredients: s.recipe_suggestion_ingredients
                .map((si) => si.ingredients)
                .filter((i): i is { id: string; name: string } => !!i),
        });
    }

    return dishes;
}

/** Dishes that already have an answer, explicit or implicit. */
async function settled(components: Component[]): Promise<Set<string>> {
    const done = new Set<string>();
    const componentIds = new Set(components.map((c) => c.id));

    const [explicitRecipes, explicitSuggestions] = await Promise.all([
        supabaseAdmin.from("recipe_components").select("recipe_id"),
        supabaseAdmin
            .from("recipe_suggestion_components")
            .select("recipe_suggestion_id"),
    ]);

    for (const row of (explicitRecipes.data ?? []) as Array<{ recipe_id: string }>) {
        done.add(row.recipe_id);
    }

    for (const row of (explicitSuggestions.data ?? []) as Array<{
        recipe_suggestion_id: string;
    }>) {
        done.add(row.recipe_suggestion_id);
    }

    // The implicit half: a dish that already LISTS a component needs nothing.
    const [ri, si] = await Promise.all([
        supabaseAdmin.from("recipe_ingredients").select("recipe_id, ingredient_id"),
        supabaseAdmin
            .from("recipe_suggestion_ingredients")
            .select("recipe_suggestion_id, ingredient_id"),
    ]);

    for (const row of (ri.data ?? []) as Array<{
        recipe_id: string;
        ingredient_id: string;
    }>) {
        if (componentIds.has(row.ingredient_id)) done.add(row.recipe_id);
    }

    for (const row of (si.data ?? []) as Array<{
        recipe_suggestion_id: string;
        ingredient_id: string;
    }>) {
        if (componentIds.has(row.ingredient_id)) {
            done.add(row.recipe_suggestion_id);
        }
    }

    return done;
}

async function propose(dish: Dish, components: Component[]): Promise<Claim[]> {
    const user = [
        `Dish: ${dish.name}`,
        `Its ingredients: ${dish.ingredients.map((i) => i.name).join(", ")}`,
        "",
        `Components you may choose from (and nothing else): ${components
            .map((c) => c.name)
            .join(", ")}`,
    ].join("\n");

    const { text: raw } = await generateCompletion({
        model: { openai: "gpt-4.1-mini" },
        label: "components.backfill",
        system: SYSTEM_PROMPT,
        user,
    });

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end <= start) return [];

    try {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as {
            components?: Claim[];
        };

        return Array.isArray(parsed.components) ? parsed.components : [];
    } catch {
        return [];
    }
}

interface Verdict {
    component: Component;
    grounded: string[];
}

/** The four gates. Returns what survives, and logs every refusal. */
function verify(
    dish: Dish,
    claims: Claim[],
    components: Component[]
): { kept: Verdict[]; refused: string[] } {
    const kept: Verdict[] = [];
    const refused: string[] = [];

    const byName = new Map(
        components.map((c) => [canonicalizeName(c.name), c] as const)
    );
    const dishIngredients = new Map(
        dish.ingredients.map((i) => [canonicalizeName(i.name), i.name] as const)
    );

    for (const claim of claims) {
        // Gate 1 — the component must already exist, vetted.
        const component = byName.get(canonicalizeName(claim.component));

        if (!component) {
            refused.push(
                `"${claim.component}" is not a classified component — invented, dropped`
            );
            continue;
        }

        // Gate 2 — a dish is never its own component.
        const dishCanonical = canonicalizeName(dish.name);

        if (
            dishCanonical === canonicalizeName(component.name) ||
            dishCanonical === canonicalizeName(component.dish) ||
            dishCanonical === component.dishCanonicalId
        ) {
            refused.push(`"${component.name}" IS this dish — dropped`);
            continue;
        }

        // Gate 3 — every grounding ingredient must really be on the dish.
        const grounded = (claim.grounded_in ?? []).filter((name) =>
            dishIngredients.has(canonicalizeName(name))
        );
        const invented = (claim.grounded_in ?? []).filter(
            (name) => !dishIngredients.has(canonicalizeName(name))
        );

        if (invented.length > 0) {
            refused.push(
                `"${component.name}" cited ingredients this dish does not have: ${invented.join(", ")}`
            );
        }

        // Gate 4 — one coincidence is not evidence.
        if (grounded.length < MIN_GROUNDING) {
            refused.push(
                `"${component.name}" rests on ${grounded.length} of this dish's ingredients (needs ${MIN_GROUNDING}) — dropped`
            );
            continue;
        }

        kept.push({ component, grounded });
    }

    return { kept, refused };
}

async function main() {
    const components = await loadComponents();

    if (components.length === 0) {
        console.error(
            "No ingredients are classified `component_kind = 'dish'`.\n" +
                "Run `nx run @fridgeezy/database:classify-ingredient-component`" +
                " with COMPONENT_APPLY=true first — this script picks from that" +
                " list and can claim nothing without it."
        );
        process.exit(1);
    }

    const all = await loadDishes();
    const done = RECLASSIFY ? new Set<string>() : await settled(components);

    let dishes = all.filter((dish) => !done.has(dish.id));
    if (ONLY) {
        dishes = dishes.filter((dish) =>
            dish.name.toLowerCase().includes(ONLY)
        );
    }
    if (LIMIT > 0) dishes = dishes.slice(0, LIMIT);

    console.log(
        `${components.length} component(s): ${components.map((c) => c.name).join(", ")}`
    );
    console.log(
        `${all.length} dish(es), ${all.length - dishes.length} already settled, ${dishes.length} to ask about` +
            (APPLY ? "" : " — DRY RUN, nothing will be written") +
            "\n"
    );

    let claimed = 0;
    let refusedTotal = 0;

    for (const dish of dishes) {
        if (dish.ingredients.length === 0) continue;

        const claims = await propose(dish, components);
        const { kept, refused } = verify(dish, claims, components);

        refusedTotal += refused.length;

        if (kept.length === 0 && refused.length === 0) continue;

        console.log(`${dish.name} (${dish.source})`);

        for (const verdict of kept) {
            console.log(
                `  + ${verdict.component.name}  — grounded in: ${verdict.grounded.join(", ")}`
            );
        }

        for (const reason of refused) console.log(`  - ${reason}`);

        if (!APPLY || kept.length === 0) continue;

        const rows = kept.map((verdict) =>
            dish.source === "recipe"
                ? { recipe_id: dish.id, ingredient_id: verdict.component.id }
                : {
                      recipe_suggestion_id: dish.id,
                      ingredient_id: verdict.component.id,
                  }
        );

        const { error } = await supabaseAdmin
            .from(
                dish.source === "recipe"
                    ? "recipe_components"
                    : "recipe_suggestion_components"
            )
            .upsert(rows as never);

        if (error) {
            console.error(`    FAILED: ${error.message}`);
        } else {
            claimed += kept.length;
        }
    }

    console.log(
        `\n${APPLY ? `${claimed} component link(s) written` : "Dry run complete"}` +
            `, ${refusedTotal} claim(s) refused by the gates.`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
