import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    EnrichedSuggestionResponseDto,
    GenerateSuggestionRequestDto,
    GenerateSuggestionResponseDto,
    GenerateSuggestionResponseSchema,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";

import { buildSuggestionsUserPrompt } from "./build-suggestions-user-prompt";
import {
    buildExistingDishesBlock,
    listCatalogDishes,
} from "./list-catalog-dishes";
import {
    persistOrReuseSuggestion,
    SuggestionOutcome,
} from "./persist-or-reuse-suggestion";

// Exported for the model-migration eval harness, which must send byte-identical
// prompts to every candidate — a copy in the eval would drift and invalidate the
// comparison. Distinct name because the services barrel re-exports this module.
export const SUGGESTIONS_SYSTEM_PROMPT = `You are a recipe suggestion assistant. Generate exactly 4 authentic, real-world recipe suggestions based on the user's request.

The "Ingredients" line below may list literal ingredients, but it may ALSO be a dish name (e.g. "sandwich", "carbonara"), a meal or course concept (e.g. "breakfast", "quick dinner", "random recipe"), or a cuisine. Interpret it flexibly:
- Literal ingredients -> real dishes that prominently feature them.
- A dish name -> authentic variations of that dish (classic and regional versions).
- A meal/course or cuisine concept -> a varied set of authentic dishes that fit it.

## Rules
- AUTHENTICITY IS PARAMOUNT: Only suggest real, well-documented recipes that exist in culinary traditions.
- Each recipe MUST be a genuine, documented dish — never an invented or descriptive name (e.g., NOT "Indian Tomato Butter Chicken"). Do NOT add alternative names in parenthesis.
- Include ALL essential ingredients that define the dish. Never omit core ingredients that make the recipe authentic.
- Only return an empty array when the request genuinely cannot be satisfied authentically — a truly incompatible INGREDIENT combination (e.g., rosemary in Thai cuisine) or nonsensical input. A real dish name, cuisine, or meal/course concept is ALWAYS satisfiable, so NEVER return an empty array for those.
- Do NOT include recipes where a blacklisted item is normally present.
- If an "Already in the catalog" list is given, NEVER suggest a dish on it, nor a translation or spelling variant of one — the user already has those. Suggest a different authentic dish that still fits the request.

## Difficulty Levels
- "easy": The standard, most authentic version of the dish with all traditional techniques and essential ingredients.
- "medium": An elevated but authentic version with refined techniques or premium ingredient variations.
- "hard": A sophisticated, chef-level authentic interpretation featuring advanced techniques or upscale variations.

## Tagging Rules (CRITICAL)
- EXACTLY 1 component tag per recipe:
  - Use the specific component type if it matches (e.g., roux for a roux, sauce for bechamel, stock for a stock)
  - Use "dish" for regular finished dishes/meals
- EXACTLY 1 cuisine tag per recipe (the most accurate cuisine origin)
- EXACTLY 1 course tag per recipe. The ONLY valid course tags are: appetizer, dessert, main, side. Pick exactly one of those four — a main dish is "main", a starter is "appetizer", an accompaniment is "side". Never omit it, and never invent another (not "dinner", "lunch", "breakfast", "entree" or "main course").
- Include ALL applicable dietary tags (e.g., vegan, gluten_free, dairy_free if the recipe qualifies)

## Ingredients
- MUST be singular
- MUST be the plain ingredient name only — NEVER include parentheses or qualifiers (e.g. "chicken breast", NOT "chicken breast (boneless)")

## Output Format
Output EXACTLY 4 recipes, one JSON object per line (JSONL format). No markdown, no code blocks, no extra text.

Each recipe object must include:
- name (the name an English-speaking home cook would most commonly recognise the dish by — keep the NATIVE name when that is what people actually say in English: Pho, Ramen, Paella, Kimchi, Gyoza, Coq au Vin, Pad Thai, Tiramisu, Risotto; use the ENGLISH name when that is the common one: "Butter Chicken" not "Murgh Makhani", "Apple Strudel" not "Apfelstrudel". Judge the whole name, not the parts: "Kimchi" stays Kimchi, but "Kimchi Jjigae" is usually met as "Kimchi Stew")
- name_alt (the OTHER name: the native spelling if \`name\` is English, the English translation if \`name\` is native. Use null when the dish is only ever known by one name — do NOT echo \`name\`, and do NOT invent a translation nobody uses)
- description (ONE complete phrase, max 60 characters — it is shown on a single-line card, so it must not read as a cut-off sentence)
- difficulty (easy, medium, or hard)
- ingredients (array of strings)
- tags (array of strings with component, cuisine, and dietary tags)`;

/**
 * `provider` overrides `LLM_PROVIDER` for this call only, which is how the two
 * providers get A/B'd in one process. It replaces the `client?: OpenAI` this took
 * before: that parameter could only ever inject an OpenAI client, so it was no
 * use for the Bedrock comparison it existed to enable.
 */
export async function* generateSuggestionsStream(
    request: GenerateSuggestionRequestDto,
    provider?: LlmProvider
): AsyncGenerator<EnrichedSuggestionResponseDto> {
    const userPrompt = buildSuggestionsUserPrompt(request);
    const existingDishes = buildExistingDishesBlock(
        await listCatalogDishes(userPrompt)
    );

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        system: SUGGESTIONS_SYSTEM_PROMPT,
        user: [userPrompt, existingDishes].filter(Boolean).join("\n"),
        provider,
    });

    // Persist/dedup each suggestion CONCURRENTLY: kick off the work as soon as
    // each JSONL line is parsed (rather than awaiting one before reading the
    // next), then yield in generation order as they resolve. Each suggestion's
    // dedup + authenticity + ingredient/tag matching is independent; the only
    // shared writes are new ingredient/tag rows, and their creates are
    // conflict-safe (reuse the row that wins a duplicate-key race).
    const pending: Promise<SuggestionOutcome>[] = [];
    for await (const { parsed } of processJsonlStream(stream, [
        GenerateSuggestionResponseSchema,
    ])) {
        const suggestion = parsed as GenerateSuggestionResponseDto;
        pending.push(persistOrReuseSuggestion(suggestion, request));
    }

    for (const persist of pending) {
        const outcome = await persist;

        // A dish the user already has as a recipe is dropped, not surfaced:
        // this endpoint returns suggestion cards, and re-offering something
        // already in the catalog is exactly the duplication being guarded
        // against. The prompt exclusion above makes this a rare fallback.
        if (outcome.kind === "existing_recipe") {
            console.log(
                `[Suggestions] Skipping "${outcome.recipe.name}" — already in the catalog as a recipe`
            );
            continue;
        }

        if (outcome.kind === "suggestion") {
            yield outcome.suggestion;
        }
    }
}
