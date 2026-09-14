import { supabaseAdmin } from "@fridgeezy/supabase";
import { foldAccents } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Recompute every stored `canonical_id` under the accent-folding rule, merging
 * the rows that turn out to be the same thing.
 *
 * The companion to `20260913000002`, which changed what FUTURE writes compute
 * and deliberately touched no existing row. This is the repair for what is
 * already stored, and it is not a blind UPDATE: folding makes some rows
 * COLLIDE, and each collision is a pair that was always one thing —
 *
 *   Ragu / Ragù        Crème Fraîche / Creme Fraiche        Jalapeño / Jalapeno
 *
 * — so the pair has to be merged, not renamed. Setting both to `ragu` would
 * violate the unique index and fail the whole statement.
 *
 * ## DRY RUN unless `FOLD_IDS_APPLY=true`
 *
 * It rewrites identity on rows people have saved and cooked from, so it prints
 * exactly what it would do and writes nothing until told. Read the merge list
 * before applying: a merge is the only irreversible thing here.
 *
 * ## What it does per table
 *
 * - **`ingredients`** — merges through the `merge_ingredient` RPC, which
 *   repoints every `recipe_ingredients` / `recipe_suggestion_ingredients` row
 *   and leaves the losing spelling behind as an ALIAS. The alias is what stops
 *   the row coming back: the next "Jalapeño" resolves through
 *   `findByAliasCanonicalIds` instead of falling through to a create.
 * - **`recipe_suggestions`, `categories`, `tag_aliases`, `units`** — a plain
 *   recompute. These are re-derived by their triggers, so the update is a
 *   no-op touch of `name` (or `alias`) rather than a direct write to
 *   `canonical_id`, which keeps ONE rule in force rather than two.
 *
 * `recipes.canonical_id` is a GENERATED column and needs no help: it is
 * recomputed from `normalize_to_canonical_id` on any write, and the dev
 * catalogue has no accented recipe names. Rows are reported if that ever stops
 * being true, since a generated column cannot be updated directly and would
 * need a touch of `name`.
 *
 * ## Which side of a pair survives
 *
 * Most-referenced wins, oldest breaks a tie — the same rule
 * `merge-spelling-variants` uses, and for the same reason: this runs against a
 * catalogue, not a style guide, and the row the data actually uses is the one
 * that costs least to keep. Note the consequence: the surviving NAME may be the
 * unaccented spelling. That is cosmetic and recoverable (rename the survivor);
 * losing the references is not.
 */
const APPLY = process.env.FOLD_IDS_APPLY === "true";

/** Mirrors `normalize_to_canonical_id` + the suggestion/category/alias triggers. */
const triggerCanonicalId = (value: string): string =>
    foldAccents(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");

/** Mirrors `set_unit_canonical_id`, which additionally strips edge underscores. */
const unitCanonicalId = (value: string): string =>
    triggerCanonicalId(value).replace(/^_|_$/g, "");

/** Mirrors `ingredient_canonical_id`: fold, collapse, trim edges, singularise. */
const singularizeToken = (tok: string): string => {
    if (tok.length <= 3) return tok;
    if (/ies$/.test(tok) && tok.length > 4) return tok.slice(0, -3) + "y";
    if (/(oes|ses|xes|zes|ches|shes)$/.test(tok)) return tok.slice(0, -2);
    if (/s$/.test(tok) && !/(ss|us|is)$/.test(tok)) return tok.slice(0, -1);
    return tok;
};

const ingredientId = (name: string): string => {
    const base = foldAccents(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!base) return base;

    const parts = base.split("_");
    parts[parts.length - 1] = singularizeToken(parts[parts.length - 1]);

    return parts.join("_");
};

interface Row {
    id: string;
    label: string;
    canonical_id: string;
    created_at?: string;
}

/** How many rows point at this ingredient. Decides which side of a pair wins. */
async function referenceCount(id: string): Promise<number> {
    const [recipes, suggestions] = await Promise.all([
        supabaseAdmin
            .from("recipe_ingredients")
            .select("recipe_id", { count: "exact", head: true })
            .eq("ingredient_id", id),
        supabaseAdmin
            .from("recipe_suggestion_ingredients")
            .select("recipe_suggestion_id", { count: "exact", head: true })
            .eq("ingredient_id", id),
    ]);

    return (recipes.count ?? 0) + (suggestions.count ?? 0);
}

async function load(
    table: string,
    labelColumn: string,
    withCreatedAt = false
): Promise<Row[]> {
    const columns = `id, ${labelColumn}, canonical_id${withCreatedAt ? ", created_at" : ""}`;
    const { data, error } = await supabaseAdmin.from(table).select(columns);

    if (error || !data) {
        console.error(`  ! failed to read ${table}: ${error?.message}`);

        return [];
    }

    return (data as unknown as Record<string, string>[]).map((row) => ({
        id: row.id,
        label: row[labelColumn],
        canonical_id: row.canonical_id,
        created_at: row.created_at,
    }));
}

/**
 * Recompute one trigger-backed table.
 *
 * The write is a touch of the LABEL column, not of `canonical_id` — the trigger
 * is what owns that value, and writing it directly here would put a second copy
 * of the rule in a script that can drift from the schema it is repairing.
 */
async function recompute(
    table: string,
    labelColumn: string,
    rule: (value: string) => string
): Promise<void> {
    const rows = await load(table, labelColumn);
    const changed = rows.filter(
        (row) => rule(row.label) !== row.canonical_id
    );

    const byNew = new Map<string, Row[]>();
    for (const row of changed) {
        const key = rule(row.label);
        byNew.set(key, [...(byNew.get(key) ?? []), row]);
    }

    // A collision here is a pair this script cannot resolve on its own: unlike
    // ingredients there is no merge RPC for these tables, and the right answer
    // (which row keeps its references) is not a string question. Report and skip.
    const colliding = [...byNew.entries()].filter(([key, rows]) => {
        const existing = rows.filter((row) => row.canonical_id === key).length;

        return rows.length + existing > 1;
    });

    console.log(`\n${table}: ${changed.length} row(s) to recompute`);

    for (const row of changed) {
        console.log(
            `  ${row.label}: ${row.canonical_id} -> ${rule(row.label)}`
        );
    }

    for (const [key, rows] of colliding) {
        console.error(
            `  ! COLLISION on "${key}": ${rows.map((row) => row.label).join(", ")} — skipped, resolve by hand`
        );
    }

    if (!APPLY || changed.length === 0) return;

    const collidingIds = new Set(
        colliding.flatMap(([, rows]) => rows.map((row) => row.id))
    );

    for (const row of changed) {
        if (collidingIds.has(row.id)) continue;

        // Re-writing the same value still fires the trigger, which is the point.
        const { error } = await supabaseAdmin
            .from(table)
            .update({ [labelColumn]: row.label })
            .eq("id", row.id);

        if (error) {
            console.error(`     FAILED ${row.label}: ${error.message}`);
        }
    }

    console.log(`  applied (${changed.length - collidingIds.size} written)`);
}

async function foldIngredients(): Promise<void> {
    const rows = await load("ingredients", "name", true);

    const byNewId = new Map<string, Row[]>();
    for (const row of rows) {
        const key = ingredientId(row.label);
        byNewId.set(key, [...(byNewId.get(key) ?? []), row]);
    }

    const merges = [...byNewId.values()].filter((group) => group.length > 1);
    const renames = [...byNewId.entries()]
        .filter(([, group]) => group.length === 1)
        .filter(([key, group]) => group[0].canonical_id !== key);

    console.log(
        `\ningredients: ${renames.length} recompute(s), ${merges.length} merge(s)`
    );

    for (const [key, group] of renames) {
        console.log(`  ${group[0].label}: ${group[0].canonical_id} -> ${key}`);
    }

    for (const group of merges) {
        const counts = await Promise.all(
            group.map((row) => referenceCount(row.id))
        );

        // Most-referenced wins, oldest breaks a tie.
        let keepIndex = 0;
        for (let i = 1; i < group.length; i++) {
            const better =
                counts[i] !== counts[keepIndex]
                    ? counts[i] > counts[keepIndex]
                    : (group[i].created_at ?? "") <
                      (group[keepIndex].created_at ?? "");

            if (better) keepIndex = i;
        }

        const keep = group[keepIndex];

        console.log(
            `  MERGE -> ${keep.label} (${counts[keepIndex]} refs, keeps id ${keep.id})`
        );

        for (let i = 0; i < group.length; i++) {
            if (i === keepIndex) continue;

            console.log(
                `         + ${group[i].label} (${counts[i]} refs) — will be kept as an alias`
            );

            if (!APPLY) continue;

            const merged = await supabaseAdmin.rpc("merge_ingredient", {
                p_from: group[i].id,
                p_into: keep.id,
            });

            if (merged.error) {
                console.error(`           FAILED: ${merged.error.message}`);
            }
        }
    }

    if (!APPLY) return;

    for (const [, group] of renames) {
        const { error } = await supabaseAdmin
            .from("ingredients")
            .update({ name: group[0].label })
            .eq("id", group[0].id);

        if (error) {
            console.error(`     FAILED ${group[0].label}: ${error.message}`);
        }
    }
}

/**
 * `recipes.canonical_id` is a GENERATED column, so it cannot be written
 * directly — it is recomputed from `normalize_to_canonical_id` on any write, and
 * touching `name` is what triggers that.
 *
 * The collision check here is the one that matters most in this script.
 * `recipes_dish_identity_difficulty_unique` spans
 * `(canonical_id, identity_cuisine, difficulty)`, and folding can bring two rows
 * onto one id — at which point the touch fails, loudly, on whichever row is
 * written second. A recipe is a thing somebody has saved and cooked from, so a
 * pair is reported and SKIPPED rather than resolved by guessing: merging two
 * recipes is a different operation with a different owner (`merge_recipe`), and
 * it is not a decision a string rule should be making unattended.
 */
async function foldRecipes(): Promise<void> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name, canonical_id, identity_cuisine, difficulty");

    if (error || !data) {
        console.error(`  ! failed to read recipes: ${error?.message}`);

        return;
    }

    const rows = data as Array<{
        id: string;
        name: string;
        canonical_id: string;
        identity_cuisine: string | null;
        difficulty: string;
    }>;

    const stale = rows.filter(
        (row) => triggerCanonicalId(row.name) !== row.canonical_id
    );

    // Identity as the unique index sees it, over the WHOLE table — a stale row
    // can collide with a row that is already correct, not only with another
    // stale one.
    const identityOf = (id: string, row: (typeof rows)[number]) =>
        `${id}|${row.identity_cuisine ?? ""}|${row.difficulty}`;

    const occupied = new Map<string, string>();
    for (const row of rows) {
        const settled = stale.includes(row)
            ? triggerCanonicalId(row.name)
            : row.canonical_id;

        const key = identityOf(settled, row);
        occupied.set(key, occupied.has(key) ? "COLLISION" : row.name);
    }

    console.log(`\nrecipes: ${stale.length} row(s) with a stale generated id`);

    for (const row of stale) {
        const next = triggerCanonicalId(row.name);
        const collides = occupied.get(identityOf(next, row)) === "COLLISION";

        console.log(
            `  ${row.name}: ${row.canonical_id} -> ${next}${collides ? "   ! COLLIDES — skipped" : ""}`
        );
    }

    if (!APPLY) return;

    for (const row of stale) {
        const next = triggerCanonicalId(row.name);

        if (occupied.get(identityOf(next, row)) === "COLLISION") {
            console.error(
                `     SKIPPED ${row.name} — another recipe already holds` +
                    ` (${next}, ${row.identity_cuisine ?? "-"}, ${row.difficulty}).` +
                    ` Resolve with merge_recipe, not here.`
            );
            continue;
        }

        // A no-op write to `name` is what makes the generated column recompute.
        const { error: writeError } = await supabaseAdmin
            .from("recipes")
            .update({ name: row.name })
            .eq("id", row.id);

        if (writeError) {
            console.error(`     FAILED ${row.name}: ${writeError.message}`);
        }
    }
}

async function main() {
    console.log(
        APPLY
            ? "Applying accent-folded canonical ids."
            : "DRY RUN — nothing will be written. Set FOLD_IDS_APPLY=true to apply."
    );

    await foldIngredients();
    await recompute("recipe_suggestions", "name", triggerCanonicalId);
    await recompute("categories", "name", triggerCanonicalId);
    await recompute("tag_aliases", "alias", triggerCanonicalId);
    await recompute("units", "name", unitCanonicalId);
    await foldRecipes();

    console.log(
        APPLY
            ? "\nDone. Re-run `embed-ingredients` if any merge changed a name."
            : "\nDry run complete."
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
