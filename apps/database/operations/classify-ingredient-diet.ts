import {
    assertDietaryVocabulary,
    classifyIngredientDiet,
    DIETARY_MODEL,
    DietaryProperty,
} from "@fridgeezy/dietary";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { Constants } from "@fridgeezy/types";
import { config } from "dotenv";

config();

/**
 * Fill in `ingredients.dietary_properties` for ingredients nobody has classified.
 *
 * This is the input side of the derived dietary filter (migrations
 * 20260803000003 / 20260803000004). Until an ingredient is classified, every
 * recipe using it has UNKNOWN dietary status and is excluded from every dietary
 * filter — deliberately, since the alternative is telling someone a dish is
 * nut-free when nobody has checked. So this operation is what turns the filter
 * on, and re-running it is what keeps it on as new ingredients arrive.
 *
 * It asks about PROPERTIES ("does this contain dairy"), never about diets ("is
 * this vegan"). Properties are objective and stable, the model is far better at
 * them, and the diets are assembled from them in SQL by `dietary_rules`.
 *
 * The prompt and the property vocabulary live in `@fridgeezy/dietary`, not here.
 * This is the BULK path — the API classifies each ingredient as it is created
 * (`classify-new-ingredients.ts`), and the two must not be able to disagree
 * about what "gluten" means. What stays here is everything that is only true of
 * a bulk run: the dry run, the caps, and the report.
 *
 * DRY RUN by default — set DIET_APPLY=true to write. Idempotent: only rows with
 * `dietary_classified_at is null` are considered, so re-running after a partial
 * run fills only what is still missing. Pass DIET_RECLASSIFY=true to revisit
 * rows that already have an answer (use after changing the prompt).
 *
 *   npx nx run @fridgeezy/database:classify-ingredient-diet
 *   DIET_APPLY=true npx nx run @fridgeezy/database:classify-ingredient-diet
 */
const APPLY = process.env.DIET_APPLY === "true";
const RECLASSIFY = process.env.DIET_RECLASSIFY === "true";
/** Only classify this many (dry runs over the whole table cost real tokens). */
const LIMIT = Number(process.env.DIET_LIMIT ?? 0);
/**
 * Comma-separated ingredient names to restrict the run to. The rows are
 * alphabetical, so without this a capped dry run only ever sees the letter A —
 * and the cases worth checking before trusting the prompt (soy sauce, gelatin,
 * plant milks, honey) are scattered through the alphabet.
 */
const ONLY = (process.env.DIET_ONLY ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
const MODEL = process.env.DIET_MODEL ?? DIETARY_MODEL;

interface Row {
    id: string;
    name: string;
}

async function unclassifiedIngredients(): Promise<Row[]> {
    let query = supabaseAdmin.from("ingredients").select("id, name").order("name");

    if (!RECLASSIFY) {
        query = query.is("dietary_classified_at", null);
    }

    const { data, error } = await query;

    if (error) throw new Error(`ingredients: ${error.message}`);

    let rows = data ?? [];

    if (ONLY.length > 0) {
        rows = rows.filter((row) => ONLY.includes(row.name.toLowerCase()));
    }

    return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

/**
 * How many recipes each unclassified ingredient is holding back — the order
 * worth working through if the list is ever too long to do in one pass.
 */
async function blockedRecipeCounts(): Promise<Map<string, number>> {
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
        `ingredient dietary classification — ${APPLY ? "APPLY (will write)" : "DRY RUN (set DIET_APPLY=true to write)"}\n`
    );

    // Before spending anything: a property the enum has gained but the prompt
    // never learned would be filtered out of every answer, leaving each affected
    // ingredient looking cleaner than it is.
    assertDietaryVocabulary(Constants.public.Enums.dietary_property);

    const rows = await unclassifiedIngredients();

    if (rows.length === 0) {
        console.log("Nothing to do — every ingredient is classified.");
        return;
    }

    const blocked = await blockedRecipeCounts();

    console.log(
        `${rows.length} ingredient(s) to classify${LIMIT > 0 ? ` (capped by DIET_LIMIT=${LIMIT})` : ""}\n`
    );

    const assigned = await classifyIngredientDiet(
        rows.map((row) => row.name),
        {
            model: MODEL,
            onSkip: (message) => console.warn(`  [skip] ${message}`),
            onProgress: (done, total) =>
                process.stdout.write(`  classified ${done}/${total}\r`),
        }
    );

    console.log();

    const resolved: Array<{ row: Row; properties: DietaryProperty[] }> = [];

    for (const row of rows) {
        const properties = assigned.get(row.name);

        if (!properties) {
            console.log(`  ??    ${row.name} — no classification`);
            continue;
        }

        const uses = blocked.get(row.id) ?? 0;
        console.log(
            `  ${(properties.length > 0 ? properties.join(",") : "-").padEnd(28)} ${row.name}${uses > 0 ? `  (${uses} recipe${uses === 1 ? "" : "s"})` : ""}`
        );
        resolved.push({ row, properties });
    }

    console.log();

    if (!APPLY) {
        console.log(
            `DRY RUN — would classify ${resolved.length}/${rows.length}. Set DIET_APPLY=true to write.`
        );
        return;
    }

    // One statement per ingredient rather than an upsert of the whole set: an
    // upsert would need every NOT NULL column of `ingredients` restated, and
    // getting one wrong would overwrite real data.
    let written = 0;

    for (const { row, properties } of resolved) {
        const { error } = await supabaseAdmin
            .from("ingredients")
            .update({
                dietary_properties: properties,
                dietary_classified_at: new Date().toISOString(),
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
