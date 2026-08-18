import { generateCompletion } from "@fridgeezy/llm";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { extractJsonObjects } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Remove a cuisine LABEL from the names of dishes already in the catalogue.
 *
 * The generator and the naming gate stopped writing them on 2026-08-18
 * (`DISH_NAME_RULE`, the "THE CUISINE IS NOT PART OF THE NAME" clause), but a
 * prompt fix cannot reach a row that already exists: dedup RESOLVES to the
 * stored row rather than regenerating it, so "Spicy Thai Cabbage Salad" would
 * keep being served under that name for as long as the row lives. Hence a
 * one-off.
 *
 * DRY RUN by default — set RENAME_APPLY=true to write. Idempotent: a name with
 * no cuisine word in it is never sent to the model, so re-running after a
 * partial run only finishes what is left.
 *
 *   npx nx run @fridgeezy/database:strip-cuisine-from-names
 *   RENAME_APPLY=true npx nx run @fridgeezy/database:strip-cuisine-from-names
 *
 * Then re-embed, because the dish signature embeds the name:
 *
 *   npx nx run @fridgeezy/database:embed-suggestions
 *   npx nx run @fridgeezy/database:embed-recipes
 *
 * A renamed row has its vector set to NULL here rather than recomputed, which is
 * exactly the state those two targets look for — they backfill rows missing a
 * vector. Leaving a stale vector behind would be the quiet failure: it stays
 * comparable, just to the wrong text, and dedup degrades instead of erroring.
 *
 * ## What it will not do
 *
 * - **Imported recipes are never touched** (`origin = 'imported'`, equivalently
 *   `created_by is not null`). That name was read off the user's own cookbook
 *   page; it is not the catalogue's to tidy.
 * - **The model may only DELETE a cuisine word.** Its proposal is rejected
 *   unless it is the original name with one or more cuisine terms removed and
 *   nothing else changed — see {@link isPureDeletion}. Renaming live rows on an
 *   LLM's say-so is otherwise a very large blast radius for a cosmetic fix.
 * - **A rename that collides is skipped, not forced.** Both tables key dish
 *   identity on `(canonical_id, identity_cuisine[, difficulty])`, so a strip can
 *   land on a row that already exists — which means these two are the same dish
 *   under two names and want merging, a decision this script has no business
 *   making. It reports them.
 */
const APPLY = process.env.RENAME_APPLY === "true";
/**
 * gpt-4o rather than the -mini the other backfills use. This is the same
 * judgement `verify-suggestion-authenticity` makes ("is this word the name or
 * the label?"), and that call sits on 4o for the same reason: mini is
 * inconsistent exactly at the margin, which here is the whole job.
 */
const MODEL = process.env.RENAME_MODEL ?? "gpt-4o";
const BATCH = 20;

/**
 * The rule, in the one form a one-off script can hold it: a copy. The shared
 * original is `DISH_NAME_RULE` in the API's `naming-rules.ts`, which this cannot
 * import — `apps/database` and `apps/api` are separate Nx projects and an
 * app-to-app import is a boundary violation. Drift is acceptable here in a way
 * it would not be between two generators: this runs once, against a fixed set of
 * rows, and its output is reviewed in the dry run before anything is written.
 */
const SYSTEM_PROMPT = `You are cleaning up dish names in a recipe catalog.

Every name you are given contains a word naming a cuisine or a place. The app already prints the cuisine directly above the title on every card, so an origin word inside the name is the same word twice, and it should go.

THE TEST: is that word part of what the dish is CALLED, or is it saying where the dish is FROM?

KEEP the word — return the name completely unchanged — in exactly these three cases:
(a) The word is INSEPARABLE from the name — take it away and what is left is not the dish's name: Pad Thai, French Onion Soup, French Toast, Greek Salad, Irish Stew, Spanish Omelette, Turkish Delight, Thai Basil Chicken, Peking Duck. This is NOT "an English menu would list it with its origin", which is true of half the catalog: "Thai Fried Rice" -> "Fried Rice", "Sichuan Boiled Fish" -> "Boiled Fish", "Thai Fish Cakes" -> "Fish Cakes". If the remainder still names the dish, the word goes.
(b) The name is a translation and the bare remainder would name something this dish IS NOT: "Vietnamese Spring Rolls" (gỏi cuốn are fresh rolls, not the fried Chinese ones), "Vietnamese Sizzling Pancake" (a bare "Sizzling Pancake" names nothing at all). If the remainder is simply TRUE of the dish, the word still goes, even when another cuisine has a dish by that bare name: "Thai Fried Rice" -> "Fried Rice", "Sichuan Boiled Fish" -> "Boiled Fish".
(c) It separates two real dishes that both exist: "Som Tam Thai" is not "Som Tam Lao"; "Hiroshima-style Okonomiyaki" is not the Osaka one.
(d) It belongs to an INGREDIENT rather than to the dish: Chinese broccoli, Chinese cabbage, Thai basil, Swiss chard, Greek yogurt, Spanish onion, French beans, Italian sausage, Japanese eggplant. These are not the plain vegetable with a flag on it — they are different ingredients. "Crispy Pork with Chinese Broccoli" keeps its broccoli.

Otherwise REMOVE it and return what is left: "Spicy Thai Cabbage Salad" -> "Spicy Cabbage Salad"; "Chinese Smashed Cucumber Salad" -> "Smashed Cucumber Salad"; "Indian Butter Chicken" -> "Butter Chicken"; "Northern Thai Pork Curry with Pickled Cabbage" -> "Pork Curry with Pickled Cabbage".

The ONLY edit you may make is deleting the origin word and closing up the spaces. Never translate, never reword, never reorder, never correct a spelling, never add a word. If deleting it would leave something that does not read as a dish name, keep the word instead.

Output one JSON object per line (JSONL), one line per dish, in the SAME ORDER as the input, and nothing else. No markdown, no code blocks.

Each line must be: {"name":"<the name EXACTLY as given>","new_name":"<the name after the edit, or the identical string when the word stays>"}`;

interface Row {
    id: string;
    name: string;
    nameEn: string | null;
    /** For the log line, and for the reader deciding whether a strip looks right. */
    cuisines: string[];
}

/** Lowercased, punctuation flattened to single spaces, padded for token search. */
const normalise = (value: string): string =>
    ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

const tokens = (value: string): string[] => normalise(value).trim().split(" ").filter(Boolean);

/**
 * Every cuisine word the catalogue knows, read from the taxonomy rather than
 * hardcoded — `matchTags` mints new cuisines at runtime, so a list in this file
 * would be stale the moment one arrives. Aliases are included because the name
 * on a row was written by a model that had no idea which spelling is canonical.
 */
async function cuisineVocabulary(): Promise<string[]> {
    const [tags, aliases] = await Promise.all([
        supabaseAdmin.from("tags").select("name, canonical_id").eq("type", "cuisine"),
        supabaseAdmin.from("tag_aliases").select("canonical_id").eq("type", "cuisine"),
    ]);

    if (tags.error) throw new Error(`tags: ${tags.error.message}`);
    if (aliases.error) throw new Error(`tag_aliases: ${aliases.error.message}`);

    const terms = new Set<string>();

    for (const row of tags.data ?? []) {
        terms.add(normalise(row.name).trim());
        terms.add(normalise(row.canonical_id).trim());
    }
    for (const row of aliases.data ?? []) {
        terms.add(normalise(row.canonical_id).trim());
    }

    // Continental and regional groupings are cuisines in the tree but are not
    // words anyone puts in a dish name in this sense — "Asian Slaw" and
    // "Mediterranean Bowl" are named that way, and stripping leaves nonsense.
    const TOO_BROAD = new Set([
        "asian",
        "european",
        "african",
        "americas",
        "american",
        "oceania",
        "australasian",
        "mediterranean",
        "middle eastern",
        "latin american",
        "south american",
        "north american",
        "caribbean",
        "nordic",
        "scandinavian",
        "balkan",
        "levantine",
        "fusion",
    ]);

    return [...terms].filter((term) => term.length > 2 && !TOO_BROAD.has(term));
}

/** The cuisine terms appearing as whole words in this name. */
const cuisineWordsIn = (name: string, vocabulary: string[]): string[] => {
    const haystack = normalise(name);
    return vocabulary.filter((term) => haystack.includes(` ${term} `));
};

/**
 * Words that are not cuisines themselves but qualify the one beside them —
 * "Northern Thai", "Hiroshima-style". Deletable only when the cuisine word they
 * are attached to is going too, so this cannot become a licence to drop
 * "Southern" from "Southern Fried Chicken", where nothing else is deleted.
 */
const CUISINE_MODIFIERS = [
    "north",
    "northern",
    "south",
    "southern",
    "east",
    "eastern",
    "west",
    "western",
    "central",
    "style",
    "styled",
];

/**
 * Is `proposed` the original with only cuisine words deleted?
 *
 * The guard that makes this script safe to point at live rows. The model is told
 * to delete and nothing else; this is what holds it to that, so the worst
 * outcome of a bad batch is a name that lost a word it should have kept — never
 * a translated, reworded or invented one. A rejected proposal is reported and
 * the row is left alone.
 *
 * What it CANNOT catch is a deletion that is well-formed and wrong: "Crispy Pork
 * with Chinese Broccoli" -> "Crispy Pork with Broccoli" is a clean single-token
 * deletion of a cuisine word, and it silently swaps gai lan for a different
 * vegetable. That one is the prompt's job (case (d)), which is why the rule is
 * stated there as well as here.
 */
function isPureDeletion(
    original: string,
    proposed: string,
    vocabulary: string[]
): boolean {
    const before = tokens(original);
    const after = tokens(proposed);

    if (after.length === 0 || after.length >= before.length) return false;

    // Multi-word cuisines ("british isles") are matched as phrases when finding
    // candidates, but the check below is per token, so flatten them.
    const cuisineTokens = new Set(vocabulary.flatMap((term) => term.split(" ")));

    // Walk both in order and record what was dropped. Anything that does not
    // line up in sequence means the model reordered or reworded rather than
    // deleted, and the proposal is refused whatever it says.
    const deleted: number[] = [];
    let cursor = 0;

    before.forEach((token, index) => {
        if (cursor < after.length && after[cursor] === token) {
            cursor++;
            return;
        }
        deleted.push(index);
    });

    if (cursor !== after.length) return false;

    const dropped = new Set(deleted);
    const isCuisine = (index: number): boolean =>
        cuisineTokens.has(before[index]);

    // Something has to have been a cuisine word, or this is some other edit
    // wearing the shape of this one.
    if (!deleted.some(isCuisine)) return false;

    return deleted.every(
        (index) =>
            isCuisine(index) ||
            (CUISINE_MODIFIERS.includes(before[index]) &&
                [index - 1, index + 1].some(
                    (neighbour) => dropped.has(neighbour) && isCuisine(neighbour)
                ))
    );
}

async function proposeRenames(rows: Row[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { text } = await generateCompletion({
            model: { openai: MODEL },
            label: "names.strip-cuisine",
            system: SYSTEM_PROMPT,
            user: batch.map((row) => row.name).join("\n"),
            maxTokens: { openai: 80 * batch.length, bedrock: 80 * batch.length },
        });

        for (const object of extractJsonObjects(text)) {
            try {
                const parsed = JSON.parse(object) as {
                    name?: string;
                    new_name?: string;
                };

                if (parsed.name && parsed.new_name) {
                    out.set(parsed.name, parsed.new_name.trim());
                }
            } catch {
                console.warn(`  [skip] unparseable object: ${object.slice(0, 80)}`);
            }
        }

        process.stdout.write(
            `  judged ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`
        );
    }

    console.log();
    return out;
}

async function loadSuggestions(vocabulary: string[]): Promise<Row[]> {
    const { data, error } = await supabaseAdmin
        .from("recipe_suggestions")
        .select("id, name, name_en, recipe_suggestion_tags ( tags ( name, type ) )");

    if (error) throw new Error(`recipe_suggestions: ${error.message}`);

    return (data ?? [])
        .filter((row) => cuisineWordsIn(row.name, vocabulary).length > 0)
        .map((row) => ({
            id: row.id,
            name: row.name,
            nameEn: row.name_en,
            cuisines: (row.recipe_suggestion_tags ?? [])
                .map((link) => link.tags)
                .filter((tag) => tag?.type === "cuisine")
                .map((tag) => tag?.name as string),
        }));
}

async function loadRecipes(vocabulary: string[]): Promise<Row[]> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("id, name, name_en, recipe_tags ( tags ( name, type ) )")
        // An import carries the name printed on the page it was read from, and
        // it belongs to one person. Not ours to tidy. `created_by` alone is the
        // right predicate — `origin = 'imported'` implies it by check constraint.
        .is("created_by", null);

    if (error) throw new Error(`recipes: ${error.message}`);

    return (data ?? [])
        .filter((row) => cuisineWordsIn(row.name, vocabulary).length > 0)
        .map((row) => ({
            id: row.id,
            name: row.name,
            nameEn: row.name_en,
            cuisines: (row.recipe_tags ?? [])
                .map((link) => link.tags)
                .filter((tag) => tag?.type === "cuisine")
                .map((tag) => tag?.name as string),
        }));
}

interface Outcome {
    renamed: number;
    kept: number;
    rejected: number;
    collided: number;
    unjudged: number;
}

async function process_(
    label: string,
    table: "recipe_suggestions" | "recipes",
    vectorColumn: "embedding" | "fts",
    rows: Row[],
    vocabulary: string[]
): Promise<Outcome> {
    const outcome: Outcome = {
        renamed: 0,
        kept: 0,
        rejected: 0,
        collided: 0,
        unjudged: 0,
    };

    if (rows.length === 0) {
        console.log(`\n${label}: nothing carrying a cuisine word\n`);
        return outcome;
    }

    console.log(`\n${label}: ${rows.length} name(s) carrying a cuisine word`);
    const proposals = await proposeRenames(rows);

    for (const row of rows) {
        const proposed = proposals.get(row.name);
        const where = row.cuisines.join(", ") || "no cuisine tag";

        if (!proposed) {
            console.log(`  ??    ${row.name} [${where}] — no answer`);
            outcome.unjudged++;
            continue;
        }

        if (normalise(proposed) === normalise(row.name)) {
            console.log(`  keep  ${row.name} [${where}]`);
            outcome.kept++;
            continue;
        }

        if (!isPureDeletion(row.name, proposed, vocabulary)) {
            console.log(
                `  BAD   ${row.name} -> "${proposed}" [${where}] — not a deletion, refused`
            );
            outcome.rejected++;
            continue;
        }

        console.log(`  strip ${row.name} -> "${proposed}" [${where}]`);

        if (!APPLY) {
            outcome.renamed++;
            continue;
        }

        const { error } = await supabaseAdmin
            .from(table)
            .update({
                name: proposed,
                // Keep the name the row used to have findable: `name_en` is half
                // of both search filters and of the cheap dedup lookup. Only
                // when it is empty — a real alternate name outranks this. Same
                // move the naming gate makes when it renames a dish.
                name_en: row.nameEn ?? row.name,
                // The dish signature embeds the name, so the stored vector now
                // describes a name that no longer exists. NULL is what
                // `embed-suggestions` / `embed-recipes` look for.
                [vectorColumn]: null,
            } as never)
            .eq("id", row.id);

        if (error) {
            if (error.code === "23505") {
                console.log(
                    `        ...collides with an existing row under that name — left alone, needs a merge`
                );
                outcome.collided++;
                continue;
            }

            throw new Error(`${table} ${row.id}: ${error.message}`);
        }

        outcome.renamed++;
    }

    return outcome;
}

async function main() {
    console.log(
        `cuisine-in-name cleanup — ${APPLY ? "APPLY (will write)" : "DRY RUN (set RENAME_APPLY=true to write)"}\n`
    );

    const vocabulary = await cuisineVocabulary();
    console.log(`${vocabulary.length} cuisine terms in the taxonomy`);

    const suggestions = await loadSuggestions(vocabulary);
    const recipes = await loadRecipes(vocabulary);

    const suggestionOutcome = await process_(
        "recipe_suggestions",
        "recipe_suggestions",
        "embedding",
        suggestions,
        vocabulary
    );
    const recipeOutcome = await process_(
        "recipes",
        "recipes",
        "fts",
        recipes,
        vocabulary
    );

    const total = (key: keyof Outcome) => suggestionOutcome[key] + recipeOutcome[key];

    console.log(
        `\n${total("renamed")} renamed, ${total("kept")} kept as they are, ` +
            `${total("rejected")} refused, ${total("collided")} collided, ` +
            `${total("unjudged")} unjudged`
    );

    if (APPLY && total("renamed") > 0) {
        console.log(
            "\nRenamed rows now have no vector. Re-embed before trusting dedup:\n" +
                "  npx nx run @fridgeezy/database:embed-suggestions\n" +
                "  npx nx run @fridgeezy/database:embed-recipes"
        );
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Rename failed:", error);
        process.exit(1);
    });
