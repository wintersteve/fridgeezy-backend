import { generateCompletion } from "@fridgeezy/llm";
import { extractJsonObjects } from "@fridgeezy/toolkit";
import { Enums } from "@fridgeezy/types";

/**
 * The objective dietary properties an ingredient can carry.
 *
 * `DietaryProperty` is the database enum itself rather than a copy of it, and
 * `DIETARY_PROPERTIES` is the runtime list the model's answers are validated
 * against. `assertDietaryVocabulary` below is what keeps the two honest — a
 * property the enum has and this list does not would be dropped from every
 * answer, and the ingredient would come out looking SAFER than it is.
 */
export type DietaryProperty = Enums<"dietary_property">;

export const DIETARY_PROPERTIES: readonly DietaryProperty[] = [
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
export const DIETARY_MODEL = "gpt-4o";

/** Ingredients per LLM call. */
const BATCH = 25;

/**
 * The single copy of the classification prompt.
 *
 * It is quoted by nothing and duplicated nowhere on purpose: it is imported by
 * the bulk backfill (`operations/classify-ingredient-diet.ts`) and by the API's
 * classify-on-create path, and those two must not be able to disagree about
 * what "gluten" means. Every rule below that reads like an over-explanation is
 * a measured failure — see the soba note in particular, where a shorter wording
 * produced a false negative on a coeliac filter.
 */
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

export interface ClassifyIngredientDietOptions {
    /** Overrides {@link DIETARY_MODEL}. */
    model?: string;
    /**
     * Called when a single answer is refused or unparseable. That ingredient is
     * left out of the result rather than failing the batch — an ingredient with
     * no answer stays unclassified, which is the safe state.
     */
    onSkip?: (message: string) => void;
    /** Called after each batch with the running count, for CLI progress. */
    onProgress?: (done: number, total: number) => void;
}

/**
 * Classify ingredient names into their objective dietary properties.
 *
 * Returns a map keyed by the name EXACTLY as passed in. A name absent from the
 * map has no answer and must be left unclassified — never written as "no
 * properties", which is a positive claim that the thing is free of all of them.
 */
export async function classifyIngredientDiet(
    names: string[],
    options: ClassifyIngredientDietOptions = {}
): Promise<Map<string, DietaryProperty[]>> {
    const { model = DIETARY_MODEL, onSkip, onProgress } = options;

    const out = new Map<string, DietaryProperty[]>();

    for (let i = 0; i < names.length; i += BATCH) {
        const batch = names.slice(i, i + BATCH);
        const { text } = await generateCompletion({
            model: { openai: model },
            system: SYSTEM_PROMPT,
            user: batch.join("\n"),
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

                const known = parsed.properties.filter(
                    (value): value is DietaryProperty =>
                        DIETARY_PROPERTIES.includes(value as DietaryProperty)
                );

                // A property the enum does not have means the prompt and the
                // schema have drifted. Dropping it silently would make the
                // ingredient look SAFER than it is, so refuse the row instead.
                if (known.length !== parsed.properties.length) {
                    const bad = parsed.properties.filter(
                        (value) =>
                            !DIETARY_PROPERTIES.includes(value as DietaryProperty)
                    );
                    onSkip?.(
                        `${parsed.name}: unknown propert${bad.length === 1 ? "y" : "ies"} ${bad.join(", ")}`
                    );
                    continue;
                }

                out.set(parsed.name, known);
            } catch {
                // A malformed object costs one ingredient, not the batch. Those
                // names stay absent from the map and so stay unclassified.
                onSkip?.(`unparseable object: ${trimmed.slice(0, 80)}`);
            }
        }

        onProgress?.(Math.min(i + BATCH, names.length), names.length);
    }

    return out;
}

/**
 * Fails loudly when {@link DIETARY_PROPERTIES} and the database enum have
 * drifted apart.
 *
 * Takes the enum's runtime values — `Constants.public.Enums.dietary_property`
 * from the generated types — because TypeScript alone cannot catch a value the
 * enum GAINED: a wider enum still satisfies the narrower literal list, and the
 * new property would simply be filtered out of every answer.
 */
export function assertDietaryVocabulary(enumValues: readonly string[]): void {
    const missing = enumValues.filter(
        (value) => !DIETARY_PROPERTIES.includes(value as DietaryProperty)
    );
    const extra = DIETARY_PROPERTIES.filter(
        (value) => !enumValues.includes(value)
    );

    if (missing.length > 0 || extra.length > 0) {
        throw new Error(
            `dietary property vocabulary drift — prompt is missing [${missing.join(", ")}], enum is missing [${extra.join(", ")}]`
        );
    }
}
