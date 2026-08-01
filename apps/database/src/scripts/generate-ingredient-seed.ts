import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { openai } from "@fridgeezy/openai";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";
import { config } from "dotenv";

config();

/**
 * Expand the curated ingredient seed toward the per-category targets using the
 * LLM, WITHOUT touching the database. Reads the hand-curated core, asks the model
 * for the missing count per category (names + aliases, excluding what already
 * exists), dedupes by canonical_id, and writes the combined set to a reviewable
 * JSON file. Review it, then load it with seed-ingredients.ts.
 *
 *   OUT_FILE (default src/scripts/data/ingredient-seed.generated.json)
 *
 * This never writes the DB — generation and loading are separate on purpose so
 * the dataset can be reviewed/edited before anything is persisted.
 */
const CORE_FILE = process.env.CORE_FILE ?? "src/scripts/data/ingredient-seed.json";
const OUT_FILE =
    process.env.OUT_FILE ?? "src/scripts/data/ingredient-seed.generated.json";
const MODEL = process.env.SEED_MODEL ?? "gpt-4o";

interface SeedIngredient {
    name: string;
    category: string;
    aliases?: string[];
    /**
     * Catalog metadata the model does not produce — it only returns names and
     * aliases. Declared so it round-trips: core entries are carried through
     * whole, and rebuilding them field-by-field here would silently drop it.
     */
    description?: string;
    shelfLife?: string;
    storageTips?: string;
}

// ~1,900 total across the 20 categories (tune freely).
const CATEGORY_TARGETS: Record<string, number> = {
    meats: 110,
    seafood: 90,
    eggs: 6,
    dairy: 70,
    vegetables: 230,
    fruits: 120,
    grains: 55,
    legumes: 45,
    nuts_seeds: 55,
    herbs_spices: 200,
    mushrooms: 30,
    noodles: 55,
    breads: 55,
    fats_oils: 35,
    sweeteners: 35,
    stocks: 20,
    sauces: 140,
    vinegars: 25,
    beverages: 70,
    baking: 70,
};

const CATEGORY_GUIDE: Record<string, string> = {
    meats: "red meat, poultry, game, cured meats, offal",
    seafood: "fish, shellfish, crustaceans, molluscs",
    eggs: "eggs of any bird",
    dairy: "milk, cream, yogurt, butter, cheeses",
    vegetables: "all vegetables incl. roots, greens, alliums, peppers, gourds",
    fruits: "fresh and dried fruit, berries, citrus",
    grains: "rice, wheat, oats, ancient grains, meals",
    legumes: "beans, lentils, peas, soy products",
    nuts_seeds: "tree nuts, peanuts, seeds, nut/seed butters",
    herbs_spices: "fresh/dried herbs, whole/ground spices, seasoning blends",
    mushrooms: "cultivated and wild edible fungi",
    noodles: "pasta shapes and Asian noodles",
    breads: "breads, flatbreads, wraps, crackers, crumbs",
    fats_oils: "cooking oils and solid fats",
    sweeteners: "sugars, syrups, honeys, sugar substitutes",
    stocks: "broths, stocks, bouillon, cooking bases",
    sauces: "sauces, condiments, pastes, dressings",
    vinegars: "all vinegar types",
    beverages: "cooking wines/spirits, juices, plant milks, coffee/tea",
    baking: "flours, leaveners, chocolate, extracts, baking staples",
};

// Ingredient identity — shared with match-ingredients.ts and mirrored by the
// SQL ingredient_canonical_id, which produced the stored canonical_id.
const toCanonicalId = ingredientCanonicalId;

async function generateForCategory(
    category: string,
    count: number,
    existingNames: string[]
): Promise<SeedIngredient[]> {
    if (count <= 0) return [];
    const system = `You build a curated culinary ingredient catalog. Return REAL, commonly-used cooking ingredients only — no dishes, no brand names, no made-up items.

Rules:
- Each ingredient is a plain noun, SINGULAR, no parentheses or qualifiers in the name (write "chicken thigh", not "chicken thigh (boneless)").
- Distinguish genuine varieties/types (e.g. "thai basil" vs "basil", "cherry tomato" vs "tomato") and states (e.g. "dried oregano" vs "oregano") as SEPARATE ingredients — these are wanted.
- "aliases" are true synonyms / regional or spelling variants of the SAME item (e.g. "coriander" for "cilantro", "aubergine" for "eggplant"). Not varieties.
- Respond with ONLY a JSON object: {"ingredients":[{"name":"...","aliases":["..."]}]}.`;
    const user = `Category: ${category} (${CATEGORY_GUIDE[category]}).
Give ${count} more ingredients in this category that are NOT already in this list:
${existingNames.join(", ") || "(none yet)"}`;

    const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return [];
    try {
        const parsed = JSON.parse(content) as {
            ingredients?: { name?: string; aliases?: string[] }[];
        };
        return (parsed.ingredients ?? [])
            .filter((i): i is { name: string; aliases?: string[] } => !!i.name)
            .map((i) => ({
                name: i.name.trim(),
                category,
                aliases: (i.aliases ?? [])
                    .map((a) => a.trim())
                    .filter(Boolean),
            }));
    } catch {
        console.error(`  ${category}: failed to parse model output`);
        return [];
    }
}

async function main() {
    const core: SeedIngredient[] = JSON.parse(
        readFileSync(join(process.cwd(), CORE_FILE), "utf8")
    );

    const byCanonical = new Map<string, SeedIngredient>();
    const perCategory = new Map<string, string[]>();
    for (const s of core) {
        const cid = toCanonicalId(s.name);
        if (!byCanonical.has(cid)) byCanonical.set(cid, s);
        const list = perCategory.get(s.category) ?? [];
        list.push(s.name);
        perCategory.set(s.category, list);
    }

    console.log(`Core: ${byCanonical.size} ingredients. Generating with ${MODEL}...\n`);

    for (const [category, target] of Object.entries(CATEGORY_TARGETS)) {
        const existing = perCategory.get(category) ?? [];
        const needed = target - existing.length;
        if (needed <= 0) {
            console.log(`${category}: have ${existing.length}/${target} — skip`);
            continue;
        }

        // Ask in chunks so the model stays reliable, feeding back what we have.
        let added = 0;
        const seenNames = [...existing];
        while (added < needed) {
            const ask = Math.min(60, needed - added);
            const batch = await generateForCategory(category, ask, seenNames);
            let newInBatch = 0;
            for (const item of batch) {
                const cid = toCanonicalId(item.name);
                if (!cid || byCanonical.has(cid)) continue;
                byCanonical.set(cid, item);
                seenNames.push(item.name);
                added++;
                newInBatch++;
            }
            console.log(`${category}: +${newInBatch} (${existing.length + added}/${target})`);
            if (newInBatch === 0) break; // model ran dry
        }
    }

    const combined = [...byCanonical.values()];
    writeFileSync(
        join(process.cwd(), OUT_FILE),
        JSON.stringify(combined, null, 2) + "\n"
    );
    console.log(
        `\nWrote ${combined.length} ingredients to ${OUT_FILE}. Review it, then:\n  SEED_FILE=${OUT_FILE} npx nx run @fridgeezy/database:seed-ingredients   # dry run\n  SEED_APPLY=true SEED_FILE=${OUT_FILE} npx nx run @fridgeezy/database:seed-ingredients`
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\nGeneration failed:", err);
        process.exit(1);
    });
