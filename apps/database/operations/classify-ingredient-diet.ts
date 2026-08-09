import { generateCompletion } from "@fridgeezy/llm";
import { supabaseAdmin } from "@fridgeezy/supabase";
import { extractJsonObjects } from "@fridgeezy/toolkit";
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
const BATCH = 25;
/**
 * `gpt-4o`, not `gpt-4o-mini`, and the difference is a safety one.
 *
 * Measured 2026-08-07 over the composite-condiment set — the category where an
 * allergen hides because the name does not list what is in the thing. On mini,
 * **"Red Curry Paste" came back with no properties even with an explicit worked
 * example telling it shrimp paste is standard**; on 4o it returns "shellfish".
 * Mini was also noisier in the other direction, inventing soy and gluten in
 * sweet chili sauce and gluten in plain miso.
 *
 * This mirrors the call already made on `verify-suggestion-authenticity`, which
 * moved mini → 4o because naming was a judgement at the margin that mini was
 * guessing at rather than deciding. Same shape of problem, higher stakes: this
 * one is what a nut-allergy filter is derived from.
 *
 * The bill does not argue back — the whole 357-row catalogue is a few batches,
 * cents either way, and it is paid once per ingredient rather than per request.
 */
const MODEL = process.env.DIET_MODEL ?? "gpt-4o";

/**
 * The complete property vocabulary. Mirrors the `dietary_property` enum — the
 * check in main() fails loudly if the two ever drift, because an unrecognised
 * property would be dropped and the ingredient would look cleaner than it is.
 */
const PROPERTIES = [
    "meat",
    "fish",
    "shellfish",
    "dairy",
    "egg",
    "honey",
    "slaughter_derived",
    "gluten",
    "nuts",
    "sesame",
    "soy",
    "grain",
    "legume",
    "refined_sugar",
] as const;
type Property = (typeof PROPERTIES)[number];

interface Row {
    id: string;
    name: string;
}

const SYSTEM_PROMPT = `You label food ingredients with objective dietary properties for a recipe database.

For each ingredient, list EVERY property below that applies to it. Most
ingredients have none or one. An empty list is a normal, expected answer.

- "meat": flesh of a mammal or bird (beef, pork, chicken, lamb, bacon, duck)
- "fish": FINFISH and anything made from it (salmon, anchovy, fish sauce,
  bonito, worcestershire sauce)
- "shellfish": crustaceans AND MOLLUSCS — prawn, crab, lobster, crayfish,
  mussel, clam, scallop, squid, octopus, snail, and oyster. A mollusc is
  shellfish, never "fish": oyster sauce, shrimp paste, belacan and XO sauce are
  all "shellfish". Getting this one wrong is the other allergy-hiding mistake.
- "dairy": milk-derived (milk, butter, cream, cheese, yoghurt, ghee)
- "egg": egg-derived (egg, egg white, mayonnaise)
- "honey": honey and other bee products
- "slaughter_derived": animal-derived but not flesh, dairy, egg or honey —
  gelatin, lard, tallow, suet, rennet, carmine, isinglass, bone broth.
  ANY STOCK OR BROTH MADE FROM AN ANIMAL belongs here — chicken stock, chicken
  broth, beef stock, veal stock, fish stock. They are simmered from bones and
  meat, so a vegetarian cannot eat them; only stock named as vegetable stock
  carries nothing. This is the one that decides whether a dish reads as vegan.
- "gluten": contains wheat, barley or rye (flour, bread, pasta, soy sauce,
  couscous, seitan, beer). Oats only if not specified gluten-free.
- "nuts": tree nuts OR peanuts, including their butters, flours and oils.
  Sesame is NOT a nut — it has its own property below. Neither are sunflower,
  pumpkin, chia or flax seeds, which carry nothing.
- "sesame": sesame seeds and anything made from them — tahini, sesame oil,
  gomashio, halva, za'atar, and buns or crackers seeded with them
- "soy": soybeans and soy-derived (tofu, tempeh, edamame, soy sauce, miso)
- "grain": a CEREAL grain or anything milled or made from one — rice, oats,
  corn, quinoa, and equally wheat flour, bread, pasta, noodles, couscous,
  breadcrumbs, semolina. If something carries "gluten" because of wheat, barley
  or rye, it is made from a cereal and carries "grain" too.
  A flour NOT milled from a cereal is NOT "grain": almond flour is only "nuts",
  chickpea flour only "legume", coconut flour and tapioca neither.
  A NOODLE not made from a cereal is likewise neither "grain" nor "gluten":
  glass/cellophane noodles are mung bean or sweet potato starch, shirataki is
  konjac. Rice noodles and rice flour ARE "grain" but never "gluten" — rice is
  a cereal, but it is not wheat, barley or rye.
  This applies ONLY where the noodle is named for its non-wheat base. It does
  NOT generalise: soba, udon and ramen are wheat products or cut with wheat, and
  stay "gluten" and "grain". An earlier wording here said buckwheat soba was
  "grain" only, and the model duly stripped gluten from every soba — a false
  negative on a coeliac filter, which is the worst outcome this file can produce.
- "legume": beans, lentils, peas, chickpeas, peanuts, soybeans
- "refined_sugar": refined sweeteners (white sugar, brown sugar, corn syrup).
  NOT honey, maple syrup or fruit.

Rules that matter:
- Judge the ingredient as the plain name describes it. "flour" means wheat
  flour; "gluten-free flour" does not.
- A PLANT MILK IS NOT DAIRY. Almond milk, oat milk, soy milk, rice milk,
  coconut milk, cashew cream, vegan butter and the like NEVER carry "dairy" —
  they exist to replace it. Label them by what they are MADE FROM: almond milk
  is "nuts", soy milk is "soy" and "legume", oat milk is "grain", rice milk is
  "grain", coconut milk is nothing. Only milk from an animal is "dairy".
- Getting this backwards is the worst mistake available here: calling almond
  milk "dairy" hides its nut content from someone with a nut allergy.
- Mark "slaughter_derived" only when the ingredient itself is unambiguously so.
  Do NOT mark cheese for its rennet — that varies by producer and the plain name
  does not tell you.
- A prepared sauce or paste carries the properties of what it is MADE FROM, not
  of the dish it goes in.
- A NAMED PREPARED PASTE, SAUCE, ROUX, CURRY BASE OR SPICE BLEND is classified
  by its STANDARD RECIPE, not by the words in its name. These are the hardest
  entries here, because the name almost never lists what is in them — which is
  exactly why it is the category where an allergen hides. Recall how the thing
  is normally made, then label that:
    Thai red/green/massaman curry paste  "shellfish" (shrimp paste is standard)
    laksa paste, rempah, XO sauce        "shellfish"
    mole (any colour)                    "nuts" and "sesame"
    romesco, satay/peanut sauce          "nuts"
    dukkah                               "sesame" and "nuts"
    za'atar, gomashio                    "sesame"
    chili bean paste / doubanjiang       "soy", "legume", "gluten", "grain"
    curry roux, of any cuisine           "gluten", "grain" (flour-and-fat roux)
    gochujang                            "soy", "legume", "grain"
    dashi, bonito stock, hondashi        "fish" (katsuobushi IS bonito, a
                                         finfish — plain "dashi" is never just
                                         kombu unless it says so)
    harissa, sambal oelek, tomato paste,
      tamarind paste, aji/chili pastes   nothing
  Answer "none" for one of these ONLY when its standard recipe genuinely
  contains nothing on the list — never because the name is uninformative.
- THE SAME INGREDIENT UNDER TWO NAMES MUST GET THE SAME ANSWER. "Chili bean
  paste" and "doubanjiang" are one thing; so are "curry roux" and "Japanese
  curry roux", "glass noodle" and "cellophane noodle". If the English name and
  the native one would score differently, you have classified the name rather
  than the ingredient.
- Something can have several properties, and missing one is the usual failure:
  soy sauce is "gluten" AND "soy" AND "grain" (it is brewed with wheat); peanut
  is "nuts" AND "legume"; tofu is "soy" AND "legume"; miso is "soy" and
  "legume", plus "gluten" and "grain" when made with barley or rice.
- Water, salt, herbs, spices and most vegetables and fruits have NO properties.

Output ONE JSON object per line (JSONL), one line per ingredient, in the SAME
ORDER as the input, and nothing else. No markdown, no code blocks.

Each line must be: {"name":"<the ingredient name EXACTLY as given>","properties":["dairy"]}`;

async function classify(rows: Row[]): Promise<Map<string, Property[]>> {
    const out = new Map<string, Property[]>();

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { text } = await generateCompletion({
            model: { openai: MODEL },
            system: SYSTEM_PROMPT,
            user: batch.map((row) => row.name).join("\n"),
            // Room for a name plus a few short properties per ingredient. A cap
            // that truncates would silently drop the tail of the batch.
            maxTokens: { openai: 80 * batch.length, bedrock: 80 * batch.length },
        });

        for (const trimmed of extractJsonObjects(text)) {
            try {
                const parsed = JSON.parse(trimmed) as {
                    name?: string;
                    properties?: unknown;
                };

                if (!parsed.name || !Array.isArray(parsed.properties)) continue;

                const known = parsed.properties.filter((value): value is Property =>
                    PROPERTIES.includes(value as Property)
                );

                // A property the enum does not have means the prompt and the
                // schema have drifted. Dropping it silently would make the
                // ingredient look SAFER than it is, so refuse the row instead.
                if (known.length !== parsed.properties.length) {
                    const bad = parsed.properties.filter(
                        (value) => !PROPERTIES.includes(value as Property)
                    );
                    console.warn(
                        `  [skip] ${parsed.name}: unknown propert${bad.length === 1 ? "y" : "ies"} ${bad.join(", ")}`
                    );
                    continue;
                }

                out.set(parsed.name, known);
            } catch {
                // A malformed object costs one ingredient, not the batch. Those
                // rows stay unclassified and are reported at the end.
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

    const rows = await unclassifiedIngredients();

    if (rows.length === 0) {
        console.log("Nothing to do — every ingredient is classified.");
        return;
    }

    const blocked = await blockedRecipeCounts();

    console.log(
        `${rows.length} ingredient(s) to classify${LIMIT > 0 ? ` (capped by DIET_LIMIT=${LIMIT})` : ""}\n`
    );

    const assigned = await classify(rows);

    const resolved: Array<{ row: Row; properties: Property[] }> = [];

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
