import { generateCompletion } from "@fridgeezy/llm";
import type { ImportRejectionCode } from "@fridgeezy/schemas";
import { z } from "zod/v4";

import {
    COMPONENT_RULE,
    DISH_FORM_RULE,
} from "../../suggestions/services/tagging-rules";

import { INGREDIENT_CATEGORY_GUIDE } from "./ingredient-categories";
import { STEP_DURATION_RULES, TEMPERATURE_RULES } from "./instruction-rules";

/**
 * How many tips the recipe screen's carousel shows, mirrored from
 * `create-recipe-stream.ts`. Enforced here as well as asked for in the prompt —
 * the instruction alone is not something the UI can rely on.
 */
const MAX_TIPS = 3;

/**
 * What the vision model returns. Snake_case throughout, matching every other LLM
 * contract in this repo (and therefore the database columns), so the mapping to
 * the camelCase frame shapes happens in exactly one place — the use case.
 *
 * Note this is a SINGLE object, not the JSONL the generators emit. Reading a
 * page is not incremental: the model has to look at the whole image before it
 * knows whether there is a recipe on it at all, which is precisely the decision
 * that must happen before any SSE header is written. See the use case for what
 * that buys.
 */
const ImportedRecipeSchema = z.object({
    /** As printed, in the language of the page. */
    name: z.string().min(1),
    /** An English rendering when `name` is not English; null when it already is. */
    name_en: z.string().nullable().optional(),
    description: z.string().default(""),
    short_description: z.string().nullable().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    servings: z.coerce.number().int().positive().default(4),
    prep_time_minutes: z.coerce.number().int().min(0).default(0),
    cook_time_minutes: z.coerce.number().int().min(0).default(0),
    kcal: z.coerce.number().int().min(0).default(0),
    carbs: z.coerce.number().int().min(0).default(0),
    protein: z.coerce.number().int().min(0).default(0),
    fat: z.coerce.number().int().min(0).default(0),
    tags: z.array(z.string()).default([]),
    ingredients: z
        .array(
            z.object({
                name: z.string().min(1),
                category: z.string().default(""),
                quantity: z.coerce.number().default(1),
                unit: z.string().min(1),
                comment: z.string().nullable().optional(),
            })
        )
        .min(1),
    instructions: z
        .array(
            z.object({
                text: z.string().min(1),
                duration_seconds: z.coerce.number().int().nullable().optional(),
                temperature_c: z.coerce.number().int().nullable().optional(),
                equipment: z.array(z.string()).nullable().optional(),
                ingredients: z.array(z.string()).nullable().optional(),
            })
        )
        .min(1),
    tips: z.array(z.string()).default([]),
    /** How much of this was legible versus reconstructed. Logged, and returned. */
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

export type ImportedRecipeRead = z.infer<typeof ImportedRecipeSchema>;

/**
 * The whole envelope. `status` is decided first and the recipe is only present
 * when it is `ok` — asking for the verdict as a field rather than inferring it
 * from an empty recipe is what makes "this is a photo of a cat" a clean 422
 * instead of a recipe with no ingredients.
 */
const ImportEnvelopeSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), recipe: ImportedRecipeSchema }),
    z.object({
        status: z.literal("not_a_recipe"),
        reason: z.string().optional(),
    }),
    z.object({
        status: z.literal("unreadable"),
        reason: z.string().optional(),
    }),
]);

export type RecipeReadOutcome =
    | { outcome: "ok"; recipe: ImportedRecipeRead }
    | { outcome: "rejected"; code: ImportRejectionCode; detail?: string }
    | { outcome: "failed"; statusCode: number; message: string };

/**
 * The prompt.
 *
 * ## Transcription, not generation — and that is the whole design
 *
 * Every other recipe prompt in this repo asks the model to WRITE a dish. This
 * one asks it to READ one, and the two want opposite instincts. A generator that
 * fills a gap with something plausible is doing its job; a transcriber that does
 * it has silently replaced the user's grandmother's method with the model's
 * average of every method like it, and nothing downstream can tell. The rules
 * below say so repeatedly and in the specific places the temptation arises,
 * because a single "be faithful" at the top does not survive a page with a
 * smudged line on it.
 *
 * ## The two places invention IS allowed, and why they are bounded
 *
 * **Nutrition.** Cookbook pages almost never print it, and the schema and the
 * database both want four integers. Estimating them is the alternative to
 * storing zeros, which the recipe screen would draw as a real "0 kcal". Bounded
 * because it is per-serving arithmetic over an ingredient list that IS on the
 * page — the model is deriving, not inventing.
 *
 * **A quantity for an unmeasured ingredient** ("salt to taste", "a splash of
 * oil"). `recipe_ingredients.quantity` is NOT NULL, so there is no way to store
 * the absence. Bounded by forcing the printed wording into `comment`, so the
 * screen still says "to taste" and the number is only ever the scaffolding under
 * it.
 *
 * Everything else — a step, an ingredient, a temperature, a time — is either on
 * the page or absent, and absent is an outcome the schema can carry.
 *
 * ## The vocabularies are the same ones the generators use
 *
 * Units, tags and ingredient categories are closed lists that persistence
 * resolves against: an unknown unit abbreviation raises inside `persist_recipe*`
 * and takes the whole import with it, and an unmatched tag is dropped with a
 * warning. So the read has to land inside them, which is why this prompt carries
 * the same three blocks the generator does. The tagging rules are imported
 * rather than restated for the same reason they are shared everywhere else.
 */
const buildImportSystemPrompt = (units: string, tags: string) =>
    `You transcribe recipes from photographs. The image is a page from a cookbook, a screenshot, a printout, or a handwritten card. Your job is to read what is ACTUALLY THERE and return it as structured JSON.

## First, decide what you are looking at

Return one of three statuses:

- "ok" — there is a recipe on this page and you can read it.
- "not_a_recipe" — the image is legible but holds no recipe. A photo of a finished dish, a shopping list, a menu, a book cover, a page of prose about food, a person, a landscape. Retrying the same photo cannot help, so say this rather than assembling something from what you can see.
- "unreadable" — there is plausibly a recipe here and you cannot read enough of it. Heavy blur, glare across the method, a fold or a thumb through the ingredients, the page cut off mid-list. A second photo of the same page would probably work.

Prefer "unreadable" over guessing. A recipe you half-read and half-invented is worse than no recipe, because the user cannot see which half is which.

## If it is a recipe: transcribe, do not compose

- Use the QUANTITIES PRINTED ON THE PAGE. Convert units only where the approved list below forces it, and never round a printed amount to a "nicer" one.
- Use the STEPS PRINTED ON THE PAGE, in their printed order, one object per step. Do not merge two steps, do not split one, do not add a step the page does not have (no invented resting, preheating or seasoning steps).
- Do not add an ingredient because the dish "should" have it. If a carbonara page lists no garlic, it has no garlic.
- Do not improve the method, modernise it, or correct it. An odd instruction is what the page says.
- If a step or an ingredient is partly legible, transcribe the legible part and stop. If most of the method is illegible, the answer is "unreadable".
- Keep the recipe's own voice in the step text. Drop only the step numbering ("1.", "Step 2:") — the client numbers them itself.

## Linking each step to its ingredients
Every instruction object carries an "ingredients" array naming the ingredients THAT STEP uses, written EXACTLY as they appear in your own ingredient list above — "cavolo nero", not "the greens"; "olive oil", not "oil". This is not decoration: the app draws the link, so a step that lists nothing is a step the user cannot tap through to what it needs.

Fill it for every step that touches an ingredient, which is nearly all of them. Only a step that genuinely uses none — "preheat the oven", "rest for 10 minutes" — gets an empty array.

## The dish name
- "name": exactly as printed, in the language of the page.
- "name_en": an English rendering when the page is not in English; null when it already is.

## Servings, times, difficulty
- "servings": as printed ("Serves 6" -> 6). Absent, use 4.
- "prep_time_minutes" / "cook_time_minutes": as printed, in whole minutes. Absent, estimate from the method — a step that says "simmer for 40 minutes" is cook time you can read. Use 0 only when there is genuinely nothing to go on.
- "difficulty": your own judgement of the method as written — "easy" for a handful of straightforward steps, "medium" for a standard recipe, "hard" for one with advanced technique, tight timing, or many components.

## Nutrition
Per serving, four integers. Cookbook pages rarely print these: if they are not on the page, ESTIMATE them from the ingredient list and the yield. This is the one place you are asked to compute rather than read — do not return zeros.

## Ingredients
One object per ingredient line, in printed order.
- "name": the plain ingredient only. NEVER put parentheses or qualifiers in the name — write "chicken breast", not "chicken breast (boneless)". Any qualifier, preparation or note goes in "comment" ("boneless", "finely chopped", "at room temperature", "plus extra for dusting").
- "quantity" + "unit": the printed amount, using ONLY an approved abbreviation below.
- An UNMEASURED ingredient ("salt to taste", "a splash of olive oil", "a handful of parsley") still needs a number, because the recipe cannot be stored without one. Use a sensible small amount AND put the printed wording in "comment" so the user still reads "to taste".
- "category": EXACTLY one of the ids below.

## Valid Unit Abbreviations
Use ONLY these. Convert a printed unit to the nearest approved one (a printed "cup" that is not in this list becomes ml or g), and never invent one:

${units}

## Valid Ingredient Categories
Set each ingredient's "category" to EXACTLY one of these ids (the id, not the description):
${INGREDIENT_CATEGORY_GUIDE}

## Valid Tags
Use ONLY these. Tag the dish you have just read — this is the one field that is your classification of the page rather than a transcription of it:

${tags}

### Tagging rules
- ${COMPONENT_RULE}
- 1 OR 2 cuisine tags. One for almost every dish — its actual origin, as specific as the approved list allows. A second ONLY when the dish genuinely belongs to two traditions at once (Tex-Mex is american + mexican). Never add one merely to be broader: "italian" must NOT also carry "mediterranean" or "european".
- EXACTLY 1 course tag per recipe. The ONLY valid course tags are: appetizer, dessert, main, side. Pick exactly one of those four. Never omit it, and never invent another (not "dinner", "lunch", "breakfast", "entree" or "main course").
- ${DISH_FORM_RULE}
- Include every dietary tag the INGREDIENT LIST supports (vegan, gluten_free, dairy_free...). Read the list, do not go by the dish's reputation.

${TEMPERATURE_RULES}

${STEP_DURATION_RULES}

## Descriptions
- "description": one or two sentences saying what the dish is. If the page has a headnote, base it on that. Otherwise write it from the recipe itself — this field is a gloss, not a transcription, and is the one line you may compose freely.
- "short_description": a single short card gloss, under 12 words.

## Tips
Only if the page prints them (a "Cook's note", a marginal tip). At most ${MAX_TIPS}. An empty array is the normal answer — do not invent advice.

## Output format
A single JSON object and nothing else. No markdown, no code fences.

When you cannot use the page, "reason" is a short description OF WHAT YOU ACTUALLY SEE, in your own words — never the wording of these examples, which describe images you are not looking at:
{"status":"not_a_recipe","reason":"<what the image is instead>"}
{"status":"unreadable","reason":"<which part you cannot read, and why>"}

When you can:
{"status":"ok","recipe":{"name":"Tarte Tatin","name_en":null,"description":"...","short_description":"...","difficulty":"medium","servings":6,"prep_time_minutes":30,"cook_time_minutes":45,"kcal":420,"carbs":52,"protein":4,"fat":22,"tags":["french","dessert"],"ingredients":[{"name":"apple","category":"fruits","quantity":1.2,"unit":"kg","comment":"peeled and quartered"}],"instructions":[{"text":"Melt the butter and sugar in an ovenproof pan until amber.","duration_seconds":600,"temperature_c":null,"equipment":["pan"],"ingredients":["butter","sugar"]}],"tips":[],"confidence":"high"}}`;

/**
 * Read a recipe off a photograph.
 *
 * One vision call, awaited in full. Nothing here streams, and the use case
 * depends on that: it is what lets an unreadable photo answer with an HTTP
 * status instead of a rejection frame on a stream that has already committed to
 * a 200.
 *
 * @param units Approved unit abbreviations, formatted for the prompt.
 * @param tags Approved tag vocabulary, formatted for the prompt.
 */
export async function readRecipeFromImage(params: {
    image: string;
    imageType: "base64" | "url";
    mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    units: string;
    tags: string;
}): Promise<RecipeReadOutcome> {
    const { text: content, finishReason } = await generateCompletion({
        // The vision model this API already uses (`ingredients/extract`). Kept
        // deliberately in step with it: they are the same task shape — one image
        // in, one JSON object out — and a divergence here would be a second
        // vision model to keep an eye on for no measured reason.
        model: { openai: "gpt-4o" },
        label: "recipe.import",
        system: buildImportSystemPrompt(params.units, params.tags),
        user: "Read the recipe on this page and return it as the JSON object described. Transcribe what is printed; do not compose a recipe.",
        image: {
            kind: params.imageType,
            data: params.image,
            mimeType: params.mimeType,
        },
        json: true,
        // A whole recipe, not a list of names — roughly four times the
        // extraction budget, and the Bedrock figure clears a thinking allowance
        // on top of that, as every one-shot call site here does. This is a real
        // ceiling rather than a cost guard: a dense two-column page with twenty
        // ingredients is the case it has to fit, and truncation is reported
        // loudly below rather than surfacing as a parse failure.
        maxTokens: { openai: 6000, bedrock: 16000 },
    });

    if (!content) {
        return {
            outcome: "failed",
            statusCode: 502,
            message: "No response from the vision model",
        };
    }

    if (finishReason === "length") {
        // Not a 502: the model worked and the page was simply bigger than the
        // budget. The actionable advice is about the photo, so it reads as a
        // rejection rather than a server fault.
        return {
            outcome: "rejected",
            code: "unreadable",
            detail: "The reading was cut off at the token limit — the page holds more than one recipe, or more than fits in one pass.",
        };
    }

    let envelope: z.infer<typeof ImportEnvelopeSchema>;
    try {
        envelope = ImportEnvelopeSchema.parse(JSON.parse(content));
    } catch (error) {
        console.error("[Import] Malformed recipe read:", error);
        return {
            outcome: "failed",
            statusCode: 502,
            message: "The vision model returned a malformed recipe",
        };
    }

    if (envelope.status !== "ok") {
        console.log(
            `[Import] Refused (${envelope.status}): ${envelope.reason ?? "no reason given"}`
        );
        return {
            outcome: "rejected",
            code: envelope.status,
            detail: envelope.reason,
        };
    }

    const recipe = envelope.recipe;

    // Cap tips the way the stream does, so the client never renders one the
    // saved recipe will not have.
    recipe.tips = recipe.tips.slice(0, MAX_TIPS);

    console.log(
        `[Import] Read "${recipe.name}" — ${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps, confidence ${recipe.confidence}`
    );

    return { outcome: "ok", recipe };
}
