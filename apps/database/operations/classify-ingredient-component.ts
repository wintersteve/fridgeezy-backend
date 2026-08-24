import {
    assertComponentVocabulary,
    classifyIngredientComponent,
    COMPONENT_MODEL,
    IngredientComponent,
} from "@fridgeezy/components";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { Constants } from "@fridgeezy/types";
import { config } from "dotenv";

config();

/**
 * Fill in `ingredients.component_kind` / `component_dish` for ingredients nobody
 * has classified.
 *
 * This is what turns on the "you can make this yourself" offer on the recipe
 * screen, and — because `component_dish_canonical_id` joins to
 * `recipes.canonical_id` — the "dishes that use this" list on a component's own
 * page. Both directions of that relationship are currently GENERATED on demand
 * and thrown away; this is the pass that makes them a query.
 *
 * Re-running it is what keeps the offer working as new ingredients arrive. The
 * API classifies each ingredient as it is created
 * (`classify-new-ingredient-components.ts`), and the two share one prompt
 * (`@fridgeezy/components`) so they cannot disagree about whether soy sauce is
 * something you make.
 *
 * DRY RUN by default — set COMPONENT_APPLY=true to write. Idempotent: only rows
 * with `component_kind is null` are considered, so re-running after a partial
 * run fills only what is still missing. Pass COMPONENT_RECLASSIFY=true to
 * revisit rows that already have an answer (use after changing the prompt).
 *
 * Read the dry run before applying. The prompt's whole design is to lean toward
 * `bought`, and the cheap way to check it is doing that is to look at what it
 * called a dish:
 *
 *   npx nx run @fridgeezy/database:classify-ingredient-component
 *   COMPONENT_ONLY="soy sauce,bechamel sauce,pizza dough,red curry paste,tomato paste,stock,cooked rice" \
 *     npx nx run @fridgeezy/database:classify-ingredient-component
 *   COMPONENT_APPLY=true npx nx run @fridgeezy/database:classify-ingredient-component
 */
const APPLY = process.env.COMPONENT_APPLY === "true";
const RECLASSIFY = process.env.COMPONENT_RECLASSIFY === "true";
/** Only classify this many (dry runs over the whole table cost real tokens). */
const LIMIT = Number(process.env.COMPONENT_LIMIT ?? 0);
/**
 * Comma-separated ingredient names to restrict the run to. The rows are
 * alphabetical, so without this a capped dry run only ever sees the letter A —
 * and the cases worth checking before trusting the prompt (soy sauce, pizza
 * dough, tomato paste, stock cubes) are scattered through it.
 */
const ONLY = (process.env.COMPONENT_ONLY ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
const MODEL = process.env.COMPONENT_MODEL ?? COMPONENT_MODEL;

interface Row {
    id: string;
    name: string;
}

async function unclassifiedIngredients(): Promise<Row[]> {
    // PAGINATED: PostgREST truncates an unbounded select at 1000 rows and says
    // nothing. On a 1027-row catalogue this returned 1000 and the remaining 27
    // were never classified — and an unclassified ingredient is INVISIBLE
    // rather than wrong (it draws no marker, exactly like the safe answer), so
    // there is no symptom to notice. That is the whole reason this loop is
    // here; `name` is uniquely constrained, so it is a total order and pages
    // cannot repeat or skip.
    const rowsAll: Row[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        let query = supabaseAdmin
            .from("ingredients")
            .select("id, name")
            .order("name")
            .range(offset, offset + pageSize - 1);

        if (!RECLASSIFY) {
            query = query.is("component_kind", null);
        }

        const { data, error } = await query;
        if (error) throw new Error(`ingredients: ${error.message}`);
        if (!data || data.length === 0) break;
        rowsAll.push(...data);
        if (data.length < pageSize) break;
    }

    let rows = rowsAll;

    if (ONLY.length > 0) {
        rows = rows.filter((row) => ONLY.includes(row.name.toLowerCase()));
    }

    return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

/**
 * How many recipes each ingredient appears in — the order worth working through
 * if the list is ever too long for one pass, and the number that says how much a
 * wrong answer costs. Soy sauce is in 7 of 50 recipes; getting that row wrong is
 * seven absurd offers, not one.
 */
async function recipeCounts(): Promise<Map<string, number>> {
    const { data, error } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("ingredient_id");

    if (error) throw new Error(`recipe_ingredients: ${error.message}`);

    const counts = new Map<string, number>();

    for (const row of data ?? []) {
        counts.set(row.ingredient_id, (counts.get(row.ingredient_id) ?? 0) + 1);
    }

    return counts;
}

async function main() {
    console.log(
        `ingredient component classification — ${APPLY ? "APPLY (will write)" : "DRY RUN (set COMPONENT_APPLY=true to write)"}\n`
    );

    // Before spending anything: a kind the enum has gained but the prompt never
    // learned would be filtered out of every answer, leaving those ingredients
    // unclassified forever with no error to explain it.
    assertComponentVocabulary(Constants.public.Enums.component_kind);

    const rows = await unclassifiedIngredients();

    if (rows.length === 0) {
        console.log("Nothing to do — every ingredient is classified.");
        return;
    }

    const uses = await recipeCounts();

    console.log(
        `${rows.length} ingredient(s) to classify${LIMIT > 0 ? ` (capped by COMPONENT_LIMIT=${LIMIT})` : ""}\n`
    );

    const assigned = await classifyIngredientComponent(
        rows.map((row) => row.name),
        {
            model: MODEL,
            onSkip: (message) => console.warn(`  [skip] ${message}`),
            onProgress: (done, total) =>
                process.stdout.write(`  classified ${done}/${total}\r`),
        }
    );

    console.log();

    const resolved: Array<{ row: Row; component: IngredientComponent }> = [];

    for (const row of rows) {
        const component = assigned.get(row.name);

        if (!component) {
            console.log(`  ??      ${row.name} — no classification`);
            continue;
        }

        const used = uses.get(row.id) ?? 0;

        // Only `dish` rows change anything on screen, so they are the only ones
        // worth reading closely. Printed with the dish they resolve to, because
        // a right kind with a wrong name is still a marker that opens the wrong
        // page.
        const answer =
            component.kind === "dish"
                ? `dish -> ${component.dish}`
                : component.kind;

        console.log(
            `  ${answer.padEnd(34)} ${row.name}${used > 0 ? `  (${used} recipe${used === 1 ? "" : "s"})` : ""}`
        );
        resolved.push({ row, component });
    }

    const dishes = resolved.filter(({ component }) => component.kind === "dish");

    console.log(
        `\n${dishes.length} of ${resolved.length} classified as a dish${
            dishes.length > 0
                ? ` — ${dishes
                      .slice(0, 12)
                      .map(({ component }) => component.dish)
                      .join(", ")}${dishes.length > 12 ? ", …" : ""}`
                : ""
        }`
    );

    if (!APPLY) {
        console.log(
            `\nDRY RUN — would classify ${resolved.length}/${rows.length}. Set COMPONENT_APPLY=true to write.`
        );
        return;
    }

    // One statement per ingredient rather than an upsert of the whole set: an
    // upsert would need every NOT NULL column of `ingredients` restated, and
    // getting one wrong would overwrite real data.
    let written = 0;

    for (const { row, component } of resolved) {
        const { error } = await supabaseAdmin
            .from("ingredients")
            .update({
                component_kind: component.kind,
                // Null on anything that is not a dish, which the check
                // constraint requires — and which is also what clears a stale
                // name when a reclassification demotes a row.
                component_dish: component.kind === "dish" ? component.dish : null,
            })
            .eq("id", row.id);

        if (error) {
            console.warn(`  [fail] ${row.name}: ${error.message}`);
            continue;
        }

        written += 1;
    }

    console.log(
        `Wrote ${written}/${rows.length}. ${rows.length - resolved.length} left unclassified.`
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
