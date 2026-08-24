import { generateCompletion } from "@fridgeezy/llm";
import { extractJsonObjects } from "@fridgeezy/toolkit";
import { Enums } from "@fridgeezy/types";

/**
 * What an ingredient line IS, for the purpose of offering a recipe for it.
 *
 * `ComponentKind` is the database enum itself rather than a copy, and
 * {@link COMPONENT_KINDS} is the runtime list answers are validated against.
 * {@link assertComponentVocabulary} keeps the two honest, for the reason its
 * dietary twin exists: TypeScript cannot catch a value the ENUM gained, and an
 * unrecognised kind would be dropped from every answer silently.
 */
export type ComponentKind = Enums<"component_kind">;

export const COMPONENT_KINDS: readonly ComponentKind[] = [
    "dish",
    "prep",
    "bought",
] as const;

/**
 * `gpt-4o`, not `gpt-4o-mini`, and for the same measured reason
 * `DIETARY_MODEL` is.
 *
 * The hard set here is identical to the one that decided that call — named
 * prepared pastes, sauces and blends, where the name says nothing about how the
 * thing comes to exist. "Red Curry Paste" and "Tomato Paste" are the same six
 * words apart and land on opposite answers; mini guesses at that margin.
 *
 * The bill does not argue back either: 1,067 ingredients is a few dozen
 * batches, paid once per ingredient rather than per request.
 */
export const COMPONENT_MODEL = "gpt-4o";

/** Ingredients per LLM call. */
const BATCH = 25;

/**
 * The single copy of the classification prompt.
 *
 * Imported by the bulk backfill (`operations/classify-ingredient-component.ts`)
 * and by the API's classify-on-create path, which must not be able to disagree
 * about whether soy sauce is something you make.
 *
 * ## The asymmetry it is written around
 *
 * A missed component costs a link nobody notices. A false one puts "make your
 * own" under SOY SAUCE — which appears in 7 of the 50 catalogue recipes — and
 * that is not merely unhelpful: it is visibly absurd, and it teaches the reader
 * to ignore the marker everywhere it is right. Every hedge below leans the same
 * way `COMPONENT_RULE` does, toward saying nothing.
 */
const SYSTEM_PROMPT = `You sort recipe ingredients into three kinds for a cooking app. The app uses
this to decide whether to offer the cook a recipe for the ingredient itself —
"you can make this yourself" under a line like "Pizza Dough, 500 g".

For each ingredient answer with exactly one kind:

- "dish": a preparation with an ESTABLISHED NAME of its own that home cooks
  genuinely make, and that a real recipe could be written for. Béchamel, pizza
  dough, pesto, chimichurri, romesco, harissa, rouille, toum, tomato sauce,
  ragù, Thai curry paste, chicken stock, shortcrust pastry, custard, mayonnaise,
  ricotta, garam masala. These are the ONLY ingredients the app offers a recipe
  for, so answer "dish" only when you could name the dish a cookbook would
  index it under.
- "prep": a plain ingredient in a prepared state. Real work, no name of its own,
  and the "recipe" would be a single sentence. Cooked rice, clarified butter,
  boiled beetroot, toasted sesame seeds, roasted peppers, caramelised onions,
  soaked dried mushrooms, blanched almonds.
- "bought": everything else, and it is the common case by a wide margin. Raw
  ingredients (flour, butter, chicken, onion, apples), anything industrially
  made (soy sauce, fish sauce, oyster sauce, hoisin, worcestershire, miso paste,
  gochujang, ketchup, stock cubes, tomato paste, panko, dried pasta, phyllo),
  and anything sold in a state nobody produces at home (ground beef, smoked
  paprika, dried chilli flakes, vanilla extract).

Rules that matter:

- WHEN IN DOUBT, ANSWER "bought". Missing a real component costs nothing a
  reader would notice. Offering to make something nobody makes is the one
  failure they WILL notice, and it makes them distrust the feature everywhere
  else. Prefer the boring answer.
- A NAME ENDING IN "sauce", "paste", "stock" OR "dough" DECIDES NOTHING. Soy
  sauce, fish sauce, oyster sauce, hoisin and worcestershire are brewed or
  manufactured products and are "bought"; béchamel, tomato sauce, chimichurri
  and peanut sauce are "dish". Tomato paste and tamarind paste are "bought";
  Thai red curry paste and ginger-garlic paste are "dish". Stock cubes are
  "bought"; chicken stock is "dish". Judge how the thing actually comes to
  exist in a home kitchen, never the last word of its name.
- A NAME TOO VAGUE TO BE ONE DISH IS "bought", whatever it sounds like. "Stock",
  "curry paste", "hot sauce" and "brown sauce" name a category rather than a
  recipe, and the app can only open ONE dish. If you cannot write down the
  single dish it would resolve to, it is not "dish".
- THE DISH NAME IS NOT ALWAYS THE INGREDIENT NAME. Give the name a cook would
  recognise: "Bechamel Sauce" resolves to "Béchamel", "Rouille Sauce" to
  "Rouille", "Vietnamese Spring Rolls Sauce" to "Nuoc Cham". Never invent a name
  and never describe one — if the only name you can give is a description of the
  ingredient, the answer is "bought".
- BOTH-WAYS INGREDIENTS ARE "dish". Plenty of cooks buy their pizza dough,
  pesto and stock, and that is fine — the app offers the choice rather than
  insisting. What disqualifies something is that making it at home is not a
  thing people do, not that buying it is common.
- THE SAME INGREDIENT UNDER TWO NAMES MUST GET THE SAME ANSWER. "Soya sauce" and
  "soy sauce" are one thing; so are "bechamel" and "white sauce".
- An ingredient qualified for a recipe — "Sugar (for sauce)", "Oil, for deep
  frying" — is the plain ingredient. Answer for the ingredient, not the phrase.

Output ONE JSON object per line (JSONL), one line per ingredient, in the SAME
ORDER as the input, and nothing else. No markdown, no code blocks.

Each line must be: {"name":"<the ingredient name EXACTLY as given>","kind":"bought"}
For "dish" only, add the dish to open: {"name":"Bechamel Sauce","kind":"dish","dish":"Béchamel"}`;

export interface IngredientComponent {
    kind: ComponentKind;
    /** The dish name to resolve. Present only when `kind` is `"dish"`. */
    dish?: string;
}

export interface ClassifyIngredientComponentOptions {
    /** Overrides {@link COMPONENT_MODEL}. */
    model?: string;
    /**
     * Called when a single answer is refused or unparseable. That ingredient is
     * left out of the result rather than failing the batch — an ingredient with
     * no answer stays unclassified, which draws exactly what `bought` draws.
     */
    onSkip?: (message: string) => void;
    /** Called after each batch with the running count, for CLI progress. */
    onProgress?: (done: number, total: number) => void;
}

/**
 * Classify ingredient names into what they are, for the make-it-yourself offer.
 *
 * Returns a map keyed by the name EXACTLY as passed in. A name absent from the
 * map has no answer and must be left unclassified. That is a safe state here in
 * a way it is not for dietary properties: unclassified and `bought` produce the
 * same thing on screen, which is nothing.
 */
export async function classifyIngredientComponent(
    names: string[],
    options: ClassifyIngredientComponentOptions = {}
): Promise<Map<string, IngredientComponent>> {
    const { model = COMPONENT_MODEL, onSkip, onProgress } = options;

    const out = new Map<string, IngredientComponent>();

    for (let i = 0; i < names.length; i += BATCH) {
        const batch = names.slice(i, i + BATCH);
        const { text } = await generateCompletion({
            model: { openai: model },
            system: SYSTEM_PROMPT,
            user: batch.join("\n"),
            // A name, a kind and sometimes a dish name. A cap that truncates
            // would silently drop the tail of the batch.
            maxTokens: { openai: 60 * batch.length, bedrock: 60 * batch.length },
        });

        for (const trimmed of extractJsonObjects(text)) {
            try {
                const parsed = JSON.parse(trimmed) as {
                    name?: string;
                    kind?: unknown;
                    dish?: unknown;
                };

                if (!parsed.name) continue;

                if (!COMPONENT_KINDS.includes(parsed.kind as ComponentKind)) {
                    onSkip?.(`${parsed.name}: unknown kind ${String(parsed.kind)}`);
                    continue;
                }

                const kind = parsed.kind as ComponentKind;
                const dish =
                    typeof parsed.dish === "string" && parsed.dish.trim().length > 0
                        ? parsed.dish.trim()
                        : undefined;

                // The database constraint says a dish has a dish and nothing
                // else does. Refuse the row here rather than letting the insert
                // fail the whole batch — and refuse a nameless "dish" outright,
                // since a marker that opens nothing is worse than no marker.
                if (kind === "dish" && !dish) {
                    onSkip?.(`${parsed.name}: kind "dish" with no dish name`);
                    continue;
                }

                out.set(parsed.name, kind === "dish" ? { kind, dish } : { kind });
            } catch {
                // A malformed object costs one ingredient, not the batch.
                onSkip?.(`unparseable object: ${trimmed.slice(0, 80)}`);
            }
        }

        onProgress?.(Math.min(i + BATCH, names.length), names.length);
    }

    return out;
}

/**
 * Fails loudly when {@link COMPONENT_KINDS} and the database enum have drifted.
 *
 * Takes the enum's runtime values (`Constants.public.Enums.component_kind`)
 * because a value the enum GAINED still satisfies the narrower literal list and
 * would simply be filtered out of every answer.
 */
export function assertComponentVocabulary(enumValues: readonly string[]): void {
    const missing = enumValues.filter(
        (value) => !COMPONENT_KINDS.includes(value as ComponentKind)
    );
    const extra = COMPONENT_KINDS.filter((value) => !enumValues.includes(value));

    if (missing.length > 0 || extra.length > 0) {
        throw new Error(
            `component kind vocabulary drift — prompt is missing [${missing.join(", ")}], enum is missing [${extra.join(", ")}]`
        );
    }
}
