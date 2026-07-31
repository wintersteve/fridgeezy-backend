import { openai } from "@fridgeezy/openai";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { config } from "dotenv";

config();

/**
 * One-time backfill for 20260731000001, which flipped what the two name columns
 * mean.
 *
 * Rows written before that migration follow the OLD rule — `name` is the dish's
 * name in its source language, `name_en` an English translation — and every read
 * coalesced `name_en ?? name`, so the translation is what users actually saw.
 * Under the new rule nothing coalesces: `name` IS the displayed name. Left alone,
 * every already-stored dish with a translation would silently start rendering
 * natively (Kimchi Jjigae instead of Kimchi Stew, Apfelstrudel instead of Apple
 * Strudel).
 *
 * So: for each distinct pair still on disk, ask which of the two names an
 * English-speaking home cook recognises the dish by, and swap the columns where
 * the answer is the one currently in `name_en`. Note this is NOT "always take
 * name_en" — that is exactly the rule the migration removed. Pho, Paella, Kimchi,
 * Ramen and Coq au Vin keep their native `name` and are left untouched.
 *
 * Idempotent: a second run re-asks and finds nothing to swap. Pass `--dry-run` to
 * print the decisions without writing.
 */

/**
 * Deliberately NOT the gpt-4o-mini used elsewhere: this is a one-off judgement
 * over ~70 pairs where a wrong call renames a dish in the live catalogue, and
 * mini kept translating well-known names ("Beef Pho" -> "Vietnamese Beef Noodle
 * Soup", "Tonkatsu" -> "Pork Cutlet"). Cost is irrelevant at this volume.
 */
const MODEL = "gpt-4o";

/** Pairs per LLM call. Small enough that one bad batch is cheap to re-run. */
const BATCH_SIZE = 40;

const SYSTEM_PROMPT = `You are naming dishes for an English-language recipe app.

Each numbered pair gives two names for the SAME dish: "a" is the native name, "b" is an English rendering. Decide which one a restaurant in an English-speaking country would PRINT ON ITS MENU.

## Default to "a"
Keeping the native name is the normal answer. Menus, cookbooks and food writing in English overwhelmingly keep a dish's own name: Pho, Ramen, Paella, Kimchi, Gyoza, Tiramisu, Coq au Vin, Pad Thai, Risotto, Hummus, Falafel, Focaccia, Paratha, Pajeon, Korokke, Szarlotka, Palak Paneer, Chana Masala, Beurre Blanc, Aglio e Olio. Pick "b" only when the test below is clearly met.

## The test: is "b" a NAME or a DESCRIPTION?
Pick "b" ONLY if it is an established English name for the dish — something people say when ordering it, not an explanation of what is in it.

- NAME (pick "b"): "Butter Chicken" for Murgh Makhani. "Apple Strudel" for Apfelstrudel. "Spring Roll" for Cha Gio. "Kimchi Stew" for Kimchi Jjigae. "Kimchi Fried Rice" for Kimchi Bokkeumbap.
- DESCRIPTION (keep "a"): "Spinach with Indian Cottage Cheese" for Palak Paneer. "Chickpea Curry" for Chana Masala. "Garlic, Oil and Chili Spaghetti" for Aglio e Olio. "Scallion Pancake" for Pajeon. "Genoese Focaccia" for Focaccia Genovese. "Indian Layered Flatbread" for Paratha. "Polish Apple Pie" for Szarlotka.

Signals that "b" is a description, so keep "a":
- it lists ingredients or method ("with…", "-style", "Sautéed…", "Seasoned…", "Stuffed…")
- it is just a nationality plus a generic noun ("Turkish Flatbread", "Korean Sweet Rice…", "Sicilian Rice Balls" for Arancini, "Vietnamese Beef Noodle Soup" for Pho)
- it merely translates the native words one for one ("Pork Cutlet" for Tonkatsu, "Shaved Ice Dessert" for Bingsu, "Scallion Pancake" for Pajeon)
- it is longer or vaguer than "a", or would fit several different dishes

If "a" and "b" are the SAME name differing only in accents, transliteration or spelling ("Sole Meunière"/"Sole Meuniere", "Gyōza"/"Gyoza"), always keep "a" — it is the correctly written form, not a translation.

A dish whose native name is already current in English food writing stays native even when a literal translation exists: Arancini, Tonkatsu, Pho, Bingsu, Pączki, Tteokbokki, Bibimbap, Ratatouille, Gnocchi, Baklava, Ceviche, Pierogi.

A dish being unfamiliar to some readers is NOT a reason to translate it — the app shows a photo and a description alongside the name.

## Output
Never invent a third name; choose "a" or "b" exactly as given. When genuinely torn, choose "a".

Respond with a single JSON object and nothing else:
{"decisions":[{"i":0,"pick":"a"},{"i":1,"pick":"b"}]}
Include every index you were given.`;

/**
 * Names the model kept wanting to translate that are plainly established in
 * English. Judged by hand off the dry run rather than by tightening the prompt
 * further — three rounds of prompt work took the swap list from 62 to 10, and
 * the remainder is short enough that a hard exclusion beats another round.
 * Matched case-insensitively against the CURRENT `name`.
 */
const NEVER_SWAP = new Set(["spanakopita"]);

interface NamePair {
    /** Current `name` — the native one under the old rule. */
    name: string;
    /** Current `name_en` — the translation under the old rule. */
    nameEn: string;
}

type Table = "recipes" | "recipe_suggestions";

const pairKey = (pair: NamePair) =>
    `${pair.name.toLowerCase().trim()}\u0000${pair.nameEn.toLowerCase().trim()}`;

/** Every distinct (name, name_en) still carrying two different names. */
async function fetchPairs(): Promise<Map<string, NamePair>> {
    const pairs = new Map<string, NamePair>();

    for (const table of ["recipes", "recipe_suggestions"] as Table[]) {
        const { data, error } = await supabaseAdmin
            .from(table)
            .select("name, name_en")
            .not("name_en", "is", null)
            .order("name");

        if (error) {
            throw new Error(`Failed to fetch ${table}: ${error.message}`);
        }

        for (const row of data ?? []) {
            const nameEn = row.name_en?.trim();
            if (!nameEn || nameEn === row.name.trim()) continue;
            if (NEVER_SWAP.has(row.name.trim().toLowerCase())) continue;

            const pair = { name: row.name, nameEn };
            pairs.set(pairKey(pair), pair);
        }
    }

    return pairs;
}

/**
 * Which of the two names wins, per pair. Fails CLOSED — a batch that errors or
 * comes back short leaves those pairs undecided, and an undecided pair keeps
 * whatever it has rather than being swapped on a guess.
 */
async function decideBatch(batch: NamePair[]): Promise<Map<string, boolean>> {
    const swap = new Map<string, boolean>();

    const listing = batch
        .map((pair, i) => `${i}. a: "${pair.name}"  b: "${pair.nameEn}"`)
        .join("\n");

    try {
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: listing },
            ],
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) return swap;

        const parsed = JSON.parse(content) as {
            decisions?: { i?: number; pick?: string }[];
        };

        for (const decision of parsed.decisions ?? []) {
            const pair = typeof decision.i === "number" && batch[decision.i];
            if (!pair) continue;
            if (decision.pick !== "a" && decision.pick !== "b") continue;

            swap.set(pairKey(pair), decision.pick === "b");
        }
    } catch (error) {
        console.error(
            "  ✗ batch failed, leaving it undecided:",
            error instanceof Error ? error.message : error
        );
    }

    return swap;
}

/** Swap `name` and `name_en` on every row matching this pair, in both tables. */
async function swapPair(pair: NamePair): Promise<number> {
    let updated = 0;

    for (const table of ["recipes", "recipe_suggestions"] as Table[]) {
        const { data, error } = await supabaseAdmin
            .from(table)
            .update({ name: pair.nameEn, name_en: pair.name })
            .eq("name", pair.name)
            .eq("name_en", pair.nameEn)
            .select("id");

        if (error) {
            console.error(`  ✗ ${table} "${pair.name}": ${error.message}`);
            continue;
        }

        updated += data?.length ?? 0;
    }

    return updated;
}

export async function normalizeRecipeNames() {
    const dryRun = process.argv.includes("--dry-run");

    console.log(
        `Starting name-semantics backfill${dryRun ? " (DRY RUN — nothing is written)" : ""}...\n`
    );

    try {
        console.log("Fetching distinct name pairs...");
        const pairs = await fetchPairs();

        if (pairs.size === 0) {
            console.log("No rows carry two different names. Nothing to do!");
            return;
        }

        console.log(`Found ${pairs.size} distinct pairs to judge.\n`);

        const all = [...pairs.values()];
        const decisions = new Map<string, boolean>();

        for (let i = 0; i < all.length; i += BATCH_SIZE) {
            const batch = all.slice(i, i + BATCH_SIZE);
            console.log(
                `Judging ${i + 1}–${i + batch.length} of ${all.length}...`
            );

            for (const [key, value] of await decideBatch(batch)) {
                decisions.set(key, value);
            }
        }

        const undecided = all.filter((pair) => !decisions.has(pairKey(pair)));
        const swaps = all.filter((pair) => decisions.get(pairKey(pair)));

        console.log(`\n${"=".repeat(50)}`);
        console.log(
            `Keep as-is: ${all.length - swaps.length - undecided.length}, swap: ${swaps.length}, undecided: ${undecided.length}\n`
        );

        for (const pair of swaps) {
            console.log(`  "${pair.name}" -> "${pair.nameEn}"`);
        }

        for (const pair of undecided) {
            console.log(`  ? undecided, left alone: "${pair.name}"`);
        }

        if (dryRun) {
            console.log("\nDry run — no rows written.");
            return;
        }

        console.log("\nApplying swaps...");
        let rowsUpdated = 0;
        for (const pair of swaps) {
            rowsUpdated += await swapPair(pair);
        }

        console.log(`\n${rowsUpdated} rows updated.`);
        console.log(
            "Re-run `nx run @fridgeezy/database:embed-recipes` and `:embed-suggestions` now — the signature text changed with the names."
        );
    } catch (error) {
        console.error(
            "\nFATAL ERROR:",
            error instanceof Error ? error.message : error
        );
        process.exit(1);
    }
}

normalizeRecipeNames()
    .then(() => {
        console.log("\nDone.");
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
