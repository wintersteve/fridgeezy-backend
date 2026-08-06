import { generateStream, type LlmProvider } from "@fridgeezy/llm";
import {
    MissingIngredientDto,
    SubstituteSuggestionDto,
    SubstituteSuggestionLlmDto,
    SubstituteSuggestionLlmSchema,
    SuggestSubstitutesRequestDto,
} from "@fridgeezy/schemas";
import { processJsonlStream } from "@fridgeezy/streaming-server";
import { canonicalizeName } from "@fridgeezy/toolkit";

import { fetchRecipeSummary, RecipeSummary } from "../../recipes/services";

// Exported for the model-migration eval harness, which must send byte-identical
// prompts to every candidate — a copy in the eval would drift and invalidate the
// comparison.
export const SUBSTITUTES_SYSTEM_PROMPT = `You are a cooking assistant suggesting ingredient substitutions for one specific dish a cook is about to make.

The cook has listed the ingredients they are MISSING. For each one, suggest what they can use instead IN THIS DISH.

## Rules
- Judge every swap in the context of THIS dish, not in the abstract: the right stand-in for butter in a shortcrust pastry is not the right one in a pan sauce.
- Respect the dish's cuisine and character. Prefer swaps a cook of that tradition would actually accept over technically-valid ones that change what the dish is.
- Suggest 2-3 substitutes per ingredient, best first.
- Prefer things a home cook is likely to already have, and do NOT suggest an ingredient the recipe already contains.
- Give a conversion in "ratio" whenever there is a meaningful one ("1:1", "3/4 the amount", "1 tbsp per clove"). Omit "ratio" entirely when a swap has no sensible conversion — never write "n/a", "varies", or a guess.
- Use "note" for a SHORT fragment saying when the swap works or what it changes ("Best for sautéing", "Adds slight sweetness", "Add off the heat"). Max 60 characters, no trailing period. Omit it when you have nothing useful to add.
- When an ingredient is genuinely optional in this dish, "Leave it out" is a legitimate first suggestion — say what is lost in the note.
- Never refuse an ingredient. Every requested ingredient gets its own line, even if the only honest advice is to omit it or accept a noticeable change.

## Output Format
Output ONE JSON object per line (JSONL), one line per missing ingredient, in the SAME ORDER they were requested. No markdown, no code blocks, no extra text.

Each object must be:
{"ingredient_name": "<the ingredient name EXACTLY as requested>", "substitutes": [{"name": "...", "ratio": "...", "note": "..."}]}`;

export const buildSubstitutesUserPrompt = (
    request: SuggestSubstitutesRequestDto,
    recipe: RecipeSummary | null
): string => {
    const lines: string[] = [`Dish: ${recipe?.name ?? request.recipeName}`];

    if (recipe?.description) lines.push(`Description: ${recipe.description}`);
    if (recipe?.difficulty) lines.push(`Difficulty: ${recipe.difficulty}`);
    if (recipe?.tags.length) {
        lines.push(`Tags: ${recipe.tags.map((tag) => tag.name).join(", ")}`);
    }

    // The full ingredient list is what makes a swap dish-aware rather than
    // generic — it tells the model what is already in the pot (so it does not
    // suggest something the recipe contains) and what the missing item is
    // working alongside.
    if (recipe?.ingredients.length) {
        lines.push(
            "",
            "The recipe calls for:",
            ...recipe.ingredients.map((item) => `- ${item.name}`)
        );
    }

    lines.push(
        "",
        "Missing ingredients (one output line each, in this order):",
        ...request.missingIngredients.map((item) => `- ${item.name}`)
    );

    return lines.join("\n");
};

/**
 * Keeps the first of any ingredients whose names canonicalize alike, preserving
 * request order. A name that canonicalizes to nothing (punctuation only) is
 * dropped — it could never be matched back to a model line anyway.
 */
const dedupeByName = (
    ingredients: MissingIngredientDto[]
): MissingIngredientDto[] => {
    const seen = new Set<string>();

    return ingredients.filter((ingredient) => {
        const key = canonicalizeName(ingredient.name);
        if (!key || seen.has(key)) return false;

        seen.add(key);
        return true;
    });
};

/**
 * What is emitted for a requested ingredient the model never returned a line
 * for. The client sizes its loading skeletons by slicing its own request list,
 * so a gap leaves that ingredient's card missing with no explanation once the
 * stream ends — better to say plainly that nothing was found than to invent
 * culinary advice to fill the hole.
 */
const buildFallback = (
    ingredient: MissingIngredientDto
): SubstituteSuggestionDto => ({
    ingredientName: ingredient.name,
    substitutes: [
        {
            name: "No substitute suggested",
            note: "Try omitting it or using something of similar texture and flavour",
        },
    ],
});

/**
 * Maps one LLM line onto the wire shape, echoing back the name the client
 * ASKED for rather than the one the model returned — the client keys its cards
 * on `ingredientName` and title-cases it for display, so a model that reformats
 * "olive oil" as "Olive Oil" must not produce a card the client cannot line up
 * with its own request.
 */
const toSuggestion = (
    parsed: SubstituteSuggestionLlmDto,
    ingredient: MissingIngredientDto
): SubstituteSuggestionDto => ({
    ingredientName: ingredient.name,
    substitutes: parsed.substitutes.map((option) => ({
        name: option.name,
        ...(option.ratio ? { ratio: option.ratio } : {}),
        ...(option.note ? { note: option.note } : {}),
    })),
});

/**
 * Streams one substitution frame per requested ingredient, in request order.
 *
 * The model is told to answer in order, but that is not enforceable, so lines
 * are matched back to the request by canonical name and buffered: as soon as
 * the next unsent position is filled, it and every already-resolved position
 * behind it flush. That keeps the response progressive — the cook sees the
 * first card while the rest are still generating — without letting an
 * out-of-order or duplicated line reorder the cards or collide on the key.
 */
export async function* generateSubstitutesStream(
    request: SuggestSubstitutesRequestDto,
    provider?: LlmProvider
): AsyncGenerator<SubstituteSuggestionDto> {
    // Deduped by canonical name, not just by id: the client keys its cards on
    // `ingredientName`, so two selections that read the same would collide there
    // however distinct their ingredient rows are. One card per distinct name.
    const requested = dedupeByName(request.missingIngredients);

    // Nothing to answer: end the stream cleanly rather than paying for a call
    // whose output would be discarded.
    if (requested.length === 0) return;

    // Best-effort: the recipe only enriches the prompt, and a cook whose recipe
    // row has gone missing still deserves an answer from the name alone.
    const recipe = await fetchRecipeSummary(request.recipeId);

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "substitutes.generate",
        system: SUBSTITUTES_SYSTEM_PROMPT,
        // Deduped list, so the model is asked for exactly the lines this stream
        // will emit.
        user: buildSubstitutesUserPrompt(
            { ...request, missingIngredients: requested },
            recipe
        ),
        provider,
    });

    // 1:1 after the dedupe above, so a model line can only ever land on the one
    // position that asked for it.
    const positionByName = new Map<string, number>(
        requested.flatMap((ingredient, index) => {
            const key = canonicalizeName(ingredient.name);
            return key ? [[key, index] as [string, number]] : [];
        })
    );

    const resolved = new Array<SubstituteSuggestionDto | undefined>(
        requested.length
    );
    let sent = 0;

    function* flush(): Generator<SubstituteSuggestionDto> {
        while (sent < resolved.length && resolved[sent]) {
            yield resolved[sent] as SubstituteSuggestionDto;
            sent++;
        }
    }

    for await (const { parsed } of processJsonlStream(stream, [
        SubstituteSuggestionLlmSchema,
    ])) {
        const line = parsed as SubstituteSuggestionLlmDto;
        const key = canonicalizeName(line.ingredient_name);
        const index = key ? positionByName.get(key) : undefined;

        if (index === undefined) {
            console.warn(
                `[Substitutes] Dropping line for "${line.ingredient_name}" — not an ingredient this request asked about`
            );
            continue;
        }

        if (resolved[index]) {
            console.warn(
                `[Substitutes] Dropping duplicate line for "${line.ingredient_name}"`
            );
            continue;
        }

        resolved[index] = toSuggestion(line, requested[index]);

        yield* flush();
    }

    // Anything the model skipped is still owed a frame.
    for (let index = sent; index < resolved.length; index++) {
        if (!resolved[index]) {
            console.warn(
                `[Substitutes] No line returned for "${requested[index].name}" — sending fallback`
            );
            resolved[index] = buildFallback(requested[index]);
        }
    }

    yield* flush();
}
