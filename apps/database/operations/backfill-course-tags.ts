import { generateCompletion } from "@fridgeezy/llm";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { extractJsonObjects } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Attach a course tag to suggestions and recipes that have none.
 *
 * Backfills the damage from a prompt bug: the suggestion prompt demanded
 * "EXACTLY 1 course tag" without ever naming the four valid values, so the model
 * skipped the field entirely and 73% of suggestions were persisted without one.
 * Recipes inherit their tags from the suggestion they are promoted from, so the
 * gap propagated there too — hence both tables.
 *
 * The prompt is fixed, so new rows are fine; this is only for the rows written
 * before that.
 *
 * DRY RUN by default — set COURSE_APPLY=true to write. Idempotent: rows that
 * already carry a course tag are never touched, so re-running after a partial
 * run only fills what is still missing.
 *
 *   npx nx run @fridgeezy/database:backfill-course-tags
 *   COURSE_APPLY=true npx nx run @fridgeezy/database:backfill-course-tags
 */
const APPLY = process.env.COURSE_APPLY === "true";
/**
 * Classified in batches rather than one call per dish: 112 individual calls is
 * both slow and needlessly expensive, and the task needs no per-dish context.
 */
const BATCH = 25;
const MODEL = process.env.COURSE_MODEL ?? "gpt-4o-mini";

/** The complete course vocabulary. Mirrors the four rows in `tags`. */
const COURSES = ["appetizer", "dessert", "main", "side"] as const;
type Course = (typeof COURSES)[number];

interface Row {
    id: string;
    name: string;
}

const SYSTEM_PROMPT = `You assign a course to each dish for a recipe database.

The ONLY valid courses are: appetizer, dessert, main, side.
- "main": the centrepiece of a meal
- "appetizer": a starter, small plate, dip or cold soup served before the meal
- "side": an accompaniment served alongside a main
- "dessert": a sweet course served after the meal

Judge the dish as it is normally eaten in its own cuisine. A dish that can be
either (a soup that is a starter in one country and a meal in another) should get
the course it most commonly has.

Some entries are components rather than finished dishes — a sauce, a stock, a
dough, a spice blend. They are never a "main": classify by what they accompany.
A savoury sauce or condiment is "side"; a sweet sauce, custard or syrup served
with a dessert is "dessert".

Output ONE JSON object per line (JSONL), one line per dish, in the SAME ORDER as
the input, and nothing else. No markdown, no code blocks.

Each line must be: {"name":"<the dish name EXACTLY as given>","course":"appetizer"|"dessert"|"main"|"side"}`;

async function classify(rows: Row[]): Promise<Map<string, Course>> {
    const out = new Map<string, Course>();

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
                    course?: string;
                };

                if (
                    parsed.name &&
                    COURSES.includes(parsed.course as Course)
                ) {
                    out.set(parsed.name, parsed.course as Course);
                }
            } catch {
                // A malformed object costs one dish, not the batch. Those rows
                // simply stay unclassified and are reported at the end.
                console.warn(`  [skip] unparseable object: ${trimmed.slice(0, 80)}`);
            }
        }

        process.stdout.write(
            `  classified ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`
        );
    }

    console.log();
    return out;
}

/**
 * Rows with no tag of type `course`.
 *
 * Written out per table rather than parameterised: the generated Supabase types
 * key the join column to the specific table, so a generic version has to cast
 * both the filter and the insert back to `Record<string, string>` — which
 * defeats the types exactly where a wrong column name would be silent.
 */
async function suggestionsMissingCourse(): Promise<Row[]> {
    const { data: rows, error } = await supabaseAdmin
        .from("recipe_suggestions")
        .select("id, name");

    if (error) throw new Error(`recipe_suggestions: ${error.message}`);

    const { data: tagged, error: tagError } = await supabaseAdmin
        .from("recipe_suggestion_tags")
        .select("recipe_suggestion_id, tags!inner(type)")
        .eq("tags.type", "course");

    if (tagError) throw new Error(`recipe_suggestion_tags: ${tagError.message}`);

    const hasCourse = new Set((tagged ?? []).map((row) => row.recipe_suggestion_id));

    return (rows ?? []).filter((row) => !hasCourse.has(row.id));
}

async function recipesMissingCourse(): Promise<Row[]> {
    const { data: rows, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name");

    if (error) throw new Error(`recipes: ${error.message}`);

    const { data: tagged, error: tagError } = await supabaseAdmin
        .from("recipe_tags")
        .select("recipe_id, tags!inner(type)")
        .eq("tags.type", "course");

    if (tagError) throw new Error(`recipe_tags: ${tagError.message}`);

    const hasCourse = new Set((tagged ?? []).map((row) => row.recipe_id));

    return (rows ?? []).filter((row) => !hasCourse.has(row.id));
}

/** Log the assignment and return only the rows that got one. */
function report(
    rows: Row[],
    assigned: Map<string, Course>
): Array<{ row: Row; course: Course }> {
    const resolved: Array<{ row: Row; course: Course }> = [];

    for (const row of rows) {
        const course = assigned.get(row.name);

        if (!course) {
            console.log(`  ??        ${row.name} — no classification`);
            continue;
        }

        console.log(`  ${course.padEnd(9)} ${row.name}`);
        resolved.push({ row, course });
    }

    return resolved;
}

async function main() {
    console.log(
        `course-tag backfill — ${APPLY ? "APPLY (will write)" : "DRY RUN (set COURSE_APPLY=true to write)"}\n`
    );

    const { data: courseTags, error } = await supabaseAdmin
        .from("tags")
        .select("id, name")
        .eq("type", "course");

    if (error) throw new Error(`tags: ${error.message}`);

    const tagIdByName = new Map(
        (courseTags ?? []).map((tag) => [tag.name.toLowerCase(), tag.id])
    );

    // Refuse rather than half-fill: if the taxonomy has drifted from the four
    // values this script (and the suggestion prompt) hardcode, every dish the
    // model assigns to the missing one would be silently dropped.
    const unknown = COURSES.filter((course) => !tagIdByName.has(course));

    if (unknown.length > 0) {
        throw new Error(
            `tags table has no course row for: ${unknown.join(", ")} — taxonomy has drifted, update COURSES`
        );
    }

    // Resolved into a total lookup now that every course is known to exist, so
    // the insert sites below need no non-null assertion.
    const tagId = Object.fromEntries(
        COURSES.map((course) => [course, tagIdByName.get(course) as string])
    ) as Record<Course, string>;

    const suggestions = await suggestionsMissingCourse();
    const recipes = await recipesMissingCourse();

    console.log(`recipe_suggestions: ${suggestions.length} without a course tag`);
    console.log(`recipes:            ${recipes.length} without a course tag\n`);

    let written = 0;
    let unresolved = 0;

    if (suggestions.length > 0) {
        console.log("--- recipe_suggestions ---");
        const resolved = report(suggestions, await classify(suggestions));
        unresolved += suggestions.length - resolved.length;

        if (APPLY && resolved.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from("recipe_suggestion_tags")
                .insert(
                    resolved.map(({ row, course }) => ({
                        recipe_suggestion_id: row.id,
                        tag_id: tagId[course],
                    }))
                );

            if (insertError) {
                throw new Error(`recipe_suggestion_tags: ${insertError.message}`);
            }

            written += resolved.length;
        }

        console.log();
    }

    if (recipes.length > 0) {
        console.log("--- recipes ---");
        const resolved = report(recipes, await classify(recipes));
        unresolved += recipes.length - resolved.length;

        if (APPLY && resolved.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from("recipe_tags")
                .insert(
                    resolved.map(({ row, course }) => ({
                        recipe_id: row.id,
                        tag_id: tagId[course],
                    }))
                );

            if (insertError) throw new Error(`recipe_tags: ${insertError.message}`);

            written += resolved.length;
        }

        console.log();
    }

    if (unresolved > 0) {
        console.log(`${unresolved} row(s) left unclassified — re-run to retry those`);
    }

    console.log(
        APPLY
            ? `wrote ${written} course tag(s)`
            : "nothing written. Re-run with COURSE_APPLY=true to apply."
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
