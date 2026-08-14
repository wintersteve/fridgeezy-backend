import { generateCompletion } from "@fridgeezy/llm";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { extractJsonObjects } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Attach a dish form tag to the suggestions and recipes that predate the rule.
 *
 * `dish_form` was added on 2026-08-03 (`20260803000008_tag_type_dish_form.sql`)
 * with a twenty-value vocabulary and a generator rule, but the catalog was
 * already written: 46 of 47 recipes and 242 of 245 suggestions were created
 * before that day, so the column has stood at ZERO rows ever since. Nothing was
 * broken — the rows simply never had a chance to carry one.
 *
 * That zero has a visible cost. The home screen ships "Soups" and "Salads" quick
 * filters keyed on `dish_form` (`RECIPE_TAG_CHIPS` in the client). They resolve
 * to a real tag id, `find_recipes` matches nothing, the catalogue reads as
 * exhausted, and the screen falls straight through to AI generation — every tap,
 * forever, because a generated dish is persisted and then also has no form. This
 * script is what makes those two chips answer from the catalogue.
 *
 * DRY RUN by default — set DISH_FORM_APPLY=true to write.
 *
 *   npx nx run @fridgeezy/database:backfill-dish-form-tags
 *   DISH_FORM_APPLY=true npx nx run @fridgeezy/database:backfill-dish-form-tags
 *
 * ## Why this one cannot be idempotent the way `backfill-course-tags` is
 *
 * That script skips any row already carrying a course, which works because every
 * dish HAS a course — a row without one is unambiguously unprocessed. A dish form
 * is optional and most dishes correctly have none, so "no form tag" means either
 * "not yet classified" or "classified, and the answer was none". They are
 * indistinguishable from the rows alone.
 *
 * So a re-run reclassifies every formless dish rather than only the new ones.
 * That is safe (writes are `on conflict do nothing` in effect — a row that gained
 * a form is skipped on the next pass) but it is not free: the second run costs
 * roughly the same LLM spend as the first. This is a one-off repair, so that is
 * the right trade against storing a "we looked and there is none" marker, which
 * would need a schema change to express.
 */
const APPLY = process.env.DISH_FORM_APPLY === "true";

/**
 * Classified in batches — the task needs no per-dish context, and one call per
 * dish over ~290 rows is both slow and needlessly expensive.
 */
const BATCH = 25;
const MODEL = process.env.DISH_FORM_MODEL ?? "gpt-4o-mini";

/**
 * The complete dish_form vocabulary, mirroring
 * `20260803000009_seed_dish_form_tags.sql` and `seeds/002_tags.sql`.
 *
 * Flat, and deliberately so: the seed migration's own note explains that
 * "stew is a kind of soup" is an argument rather than a fact, and nesting it
 * would make a soup filter quietly return stews.
 */
const FORMS = [
    "soup",
    "stew",
    "salad",
    "sandwich",
    "wrap",
    "pizza",
    "pasta",
    "noodles",
    "curry",
    "stir fry",
    "roast",
    "bake",
    "casserole",
    "grill",
    "pie",
    "dumpling",
    "rice dish",
    "porridge",
    "pancake",
    "skewer",
] as const;
type Form = (typeof FORMS)[number];

interface Row {
    id: string;
    name: string;
}

/**
 * The prompt is the generators' `DISH_FORM_RULE` restated for a classifier that
 * sees a bare name and must be free to answer "none".
 *
 * The "none" branch is the whole difficulty. A classifier asked to pick from a
 * closed list will pick from it, and a catalog where every dish is a "roast" or a
 * "bake" is strictly worse than one where none are — the filter stops separating
 * anything and the chips return noise. Hence the explicit instruction that none
 * is the EXPECTED answer, and the worked examples on both sides.
 */
const SYSTEM_PROMPT = `You assign a DISH FORM to each dish for a recipe database, or decide it has none.

The ONLY valid forms are: ${FORMS.join(", ")}.

Form is the SHAPE the dish takes — how it is built and eaten — not when it is served and not how it is cooked.
- A soup served as a starter is still form "soup". The course it fills is a separate question you are NOT being asked.
- "roast", "bake" and "grill" are forms only when the dish IS that thing (a Sunday roast, a gratin, a mixed grill). A braise that happens to go in the oven is not a "bake".
- Pick the form the dish most obviously IS. Ramen is "noodles", not "soup". Lasagne is "pasta", not "bake". A burrito is a "wrap". Shepherd's Pie is a "pie".

MOST DISHES HAVE NO FORM, and "none" is the expected answer, not a failure. A dish that is simply a plate of food — a protein with sides, a stir-fried plate served with rice, a cake, a tart, a plate of grilled meat with salad — has NO form. Do not stretch a dish to fit one of the twenty words. Returning "none" for two thirds of the input is a correct outcome.
- Chicken Tikka Masala is "curry". Beef Bourguignon is "stew". Caesar Salad is "salad". Pad Thai is "noodles". Margherita is "pizza". Congee is "porridge". Gyoza is "dumpling". Yakitori is "skewer".
- Beef Wellington has NO form. Tiramisu has NO form. Crème Brûlée has NO form. Peking Duck has NO form. Fish and Chips has NO form. Guacamole has NO form.

Output ONE JSON object per line (JSONL), one line per dish, in the SAME ORDER as the input, and nothing else. No markdown, no code blocks.

Each line must be: {"name":"<the dish name EXACTLY as given>","form":"<one of the forms above>"|"none"}`;

async function classify(rows: Row[]): Promise<Map<string, Form>> {
    const out = new Map<string, Form>();
    let none = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { text } = await generateCompletion({
            model: { openai: MODEL },
            system: SYSTEM_PROMPT,
            user: batch.map((row) => row.name).join("\n"),
            // Sized for one short JSON object per dish, with headroom — a cap
            // that truncates would silently drop the tail of the batch.
            maxTokens: { openai: 60 * batch.length, bedrock: 60 * batch.length },
        });

        // Brace-matched rather than split on newlines: the model sometimes runs
        // several objects together on one line, and a line-based parse discards
        // every dish on such a line instead of just the malformed one.
        for (const trimmed of extractJsonObjects(text)) {
            try {
                const parsed = JSON.parse(trimmed) as {
                    name?: string;
                    form?: string;
                };

                if (!parsed.name) continue;

                // "none" is a real answer and must not be recorded as a form.
                // Anything outside the vocabulary is treated the same way rather
                // than created — this script never widens the taxonomy.
                if (FORMS.includes(parsed.form as Form)) {
                    out.set(parsed.name, parsed.form as Form);
                } else {
                    none += 1;
                }
            } catch {
                // A malformed object costs one dish, not the batch. Those rows
                // simply stay unclassified and are reported at the end.
                console.warn(
                    `  [skip] unparseable object: ${trimmed.slice(0, 80)}`
                );
            }
        }

        process.stdout.write(
            `  classified ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`
        );
    }

    console.log(`\n  (${none} judged to have no form)`);
    return out;
}

/**
 * Vocabulary terms whose names double as COOKING VERBS, so a dish name
 * containing one says nothing reliable about the dish's shape.
 *
 * Measured, not guessed. A naive name match over the whole vocabulary proposed
 * `roast` for "Ghee Roast Dosa" (a dosa — "roast" is the style of the batter),
 * and `stew` for "Braised Abalone with Oyster Sauce" via the `braise` alias.
 * Both are wrong, and both are wrong in the same way: the word describes how the
 * dish was cooked, not what it is.
 *
 * That distinction is the seed migration's own rule — "It is not a cooking-method
 * taxonomy — 'braised' and 'poached' belong to the technique data, not here" —
 * which these four values sit awkwardly against, since they are the only entries
 * that are verbs as much as nouns. They stay in the vocabulary because a Sunday
 * roast and a mixed grill really are forms; they are excluded HERE because only
 * the LLM can tell that case from an adjective.
 */
const METHOD_SHAPED_TERMS = new Set(["roast", "bake", "grill", "stir fry", "braise"]);

/**
 * Assign a form from the dish's NAME alone, using the curated vocabulary and its
 * alias table.
 *
 * Runs before the LLM, and exists because the LLM was demonstrably unreliable
 * here: four dishes literally named "Risotto …" came back with no form, while
 * `risotto` has been a seeded alias for `rice dish` since the vocabulary landed.
 * The same pass fixes "Kimchi Fried Rice", which the model tagged as a suggestion
 * and missed as a recipe — the same dish, two answers, which is the failure mode
 * users actually notice.
 *
 * Deterministic by design. Every row this settles is one the LLM cannot answer
 * differently on the next run, which matters more than the handful of rows it
 * adds: run-to-run drift is what put two risottos on screen with different
 * eyebrows.
 *
 * WORD BOUNDARIES, not substrings. "Ensaladilla Rusa" contains the letters of
 * `salad` inside a Spanish diminutive, and matching that way would be right by
 * accident here and wrong elsewhere. The LLM still sees anything this skips.
 *
 * Longest term first, so `fried rice` wins over `rice` rather than racing it.
 */
function matchFormsByName(
    rows: Row[],
    termToForm: Map<string, Form>
): Map<string, Form> {
    const terms = [...termToForm.keys()]
        .filter((term) => !METHOD_SHAPED_TERMS.has(term))
        .sort((a, b) => b.length - a.length);

    const out = new Map<string, Form>();

    for (const row of rows) {
        const name = row.name.toLowerCase();

        for (const term of terms) {
            // \b is unreliable next to non-ASCII, which these names are full of
            // ("Bánh", "Dürüm"), so the boundary is spelled out as "not a letter".
            const boundary = new RegExp(
                `(^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`,
                "u"
            );

            if (boundary.test(name)) {
                out.set(row.name, termToForm.get(term) as Form);
                break;
            }
        }
    }

    return out;
}

/**
 * Rows with no tag of type `dish_form`.
 *
 * Written out per table rather than parameterised, for the reason
 * `backfill-course-tags` gives: the generated Supabase types key the join column
 * to the specific table, so a generic version has to cast both the filter and the
 * insert back to `Record<string, string>` — which defeats the types exactly where
 * a wrong column name would be silent.
 */
async function suggestionsMissingForm(): Promise<Row[]> {
    const { data: rows, error } = await supabaseAdmin
        .from("recipe_suggestions")
        .select("id, name");

    if (error) throw new Error(`recipe_suggestions: ${error.message}`);

    const { data: tagged, error: tagError } = await supabaseAdmin
        .from("recipe_suggestion_tags")
        .select("recipe_suggestion_id, tags!inner(type)")
        .eq("tags.type", "dish_form");

    if (tagError) throw new Error(`recipe_suggestion_tags: ${tagError.message}`);

    const hasForm = new Set(
        (tagged ?? []).map((row) => row.recipe_suggestion_id)
    );

    return (rows ?? []).filter((row) => !hasForm.has(row.id));
}

async function recipesMissingForm(): Promise<Row[]> {
    const { data: rows, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name");

    if (error) throw new Error(`recipes: ${error.message}`);

    const { data: tagged, error: tagError } = await supabaseAdmin
        .from("recipe_tags")
        .select("recipe_id, tags!inner(type)")
        .eq("tags.type", "dish_form");

    if (tagError) throw new Error(`recipe_tags: ${tagError.message}`);

    const hasForm = new Set((tagged ?? []).map((row) => row.recipe_id));

    return (rows ?? []).filter((row) => !hasForm.has(row.id));
}

/** Log the assignment and return only the rows that got a form. */
function report(
    rows: Row[],
    assigned: Map<string, Form>
): Array<{ row: Row; form: Form }> {
    const resolved: Array<{ row: Row; form: Form }> = [];

    for (const row of rows) {
        const form = assigned.get(row.name);

        // Not logged per row: "no form" is the majority outcome here, and
        // printing 200 lines of it would bury the assignments that matter.
        if (!form) continue;

        console.log(`  ${form.padEnd(10)} ${row.name}`);
        resolved.push({ row, form });
    }

    return resolved;
}

/**
 * Name pass first, LLM for the remainder.
 *
 * The order is the point. Anything the curated vocabulary can settle is settled
 * deterministically and never reaches the model, which both removes the run-to-
 * run drift on those rows and shrinks the batch that costs money. It mirrors
 * `matchTags`, where the cheap exact layers run ahead of the guessing one for the
 * same reason.
 */
async function resolveForms(
    rows: Row[],
    termToForm: Map<string, Form>
): Promise<Map<string, Form>> {
    const byName = matchFormsByName(rows, termToForm);

    if (byName.size > 0) {
        console.log(`  ${byName.size} settled by name (no LLM call):`);
        for (const [name, form] of byName) {
            console.log(`    ${form.padEnd(10)} ${name}`);
        }
    }

    const remaining = rows.filter((row) => !byName.has(row.name));

    if (remaining.length === 0) return byName;

    const byModel = await classify(remaining);

    // Name matches win on collision. They cannot collide today — the model only
    // sees what the name pass left — but stating it keeps the merge honest if the
    // two ever overlap.
    return new Map([...byModel, ...byName]);
}

async function main() {
    console.log(
        `dish-form backfill — ${APPLY ? "APPLY (will write)" : "DRY RUN (set DISH_FORM_APPLY=true to write)"}\n`
    );

    const { data: formTags, error } = await supabaseAdmin
        .from("tags")
        .select("id, name")
        .eq("type", "dish_form");

    if (error) throw new Error(`tags: ${error.message}`);

    const tagIdByName = new Map(
        (formTags ?? []).map((tag) => [tag.name.toLowerCase(), tag.id])
    );

    // Refuse rather than half-fill: if the taxonomy has drifted from the twenty
    // values this script and the generator prompts hardcode, every dish the model
    // assigns to a missing one would be silently dropped.
    const unknown = FORMS.filter((form) => !tagIdByName.has(form));

    if (unknown.length > 0) {
        throw new Error(
            `tags table has no dish_form row for: ${unknown.join(", ")} — taxonomy has drifted, update FORMS`
        );
    }

    // Resolved into a total lookup now that every form is known to exist, so the
    // insert sites below need no non-null assertion.
    const tagId = Object.fromEntries(
        FORMS.map((form) => [form, tagIdByName.get(form) as string])
    ) as Record<Form, string>;

    // The name-match vocabulary: each form's own name plus every curated
    // alternate spelling. Read from `tag_aliases` rather than hardcoded, so the
    // pass widens automatically when an alias is added — the alias table is
    // already the place that knows "risotto" is a rice dish.
    const { data: aliasRows, error: aliasError } = await supabaseAdmin
        .from("tag_aliases")
        .select("alias, tags!inner(name, type)")
        .eq("tags.type", "dish_form");

    if (aliasError) throw new Error(`tag_aliases: ${aliasError.message}`);

    const termToForm = new Map<string, Form>(
        FORMS.map((form) => [form, form] as const)
    );

    for (const row of aliasRows ?? []) {
        const form = (row.tags as unknown as { name: string }).name.toLowerCase();
        if (FORMS.includes(form as Form)) {
            termToForm.set(row.alias.toLowerCase(), form as Form);
        }
    }

    console.log(
        `name-match vocabulary: ${termToForm.size} term(s), ${METHOD_SHAPED_TERMS.size} excluded as cooking verbs\n`
    );

    const suggestions = await suggestionsMissingForm();
    const recipes = await recipesMissingForm();

    console.log(
        `recipe_suggestions: ${suggestions.length} without a dish form tag`
    );
    console.log(`recipes:            ${recipes.length} without a dish form tag\n`);

    let written = 0;

    if (suggestions.length > 0) {
        console.log("--- recipe_suggestions ---");
        const resolved = report(
            suggestions,
            await resolveForms(suggestions, termToForm)
        );

        if (APPLY && resolved.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from("recipe_suggestion_tags")
                .insert(
                    resolved.map(({ row, form }) => ({
                        recipe_suggestion_id: row.id,
                        tag_id: tagId[form],
                    }))
                );

            if (insertError) {
                throw new Error(
                    `recipe_suggestion_tags: ${insertError.message}`
                );
            }

            written += resolved.length;
        }

        console.log(`  ${resolved.length} form(s) assigned\n`);
    }

    if (recipes.length > 0) {
        console.log("--- recipes ---");
        const resolved = report(recipes, await resolveForms(recipes, termToForm));

        if (APPLY && resolved.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from("recipe_tags")
                .insert(
                    resolved.map(({ row, form }) => ({
                        recipe_id: row.id,
                        tag_id: tagId[form],
                    }))
                );

            if (insertError) throw new Error(`recipe_tags: ${insertError.message}`);

            written += resolved.length;
        }

        console.log(`  ${resolved.length} form(s) assigned\n`);
    }

    console.log(
        APPLY
            ? `wrote ${written} dish form tag(s)`
            : "nothing written. Re-run with DISH_FORM_APPLY=true to apply."
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
