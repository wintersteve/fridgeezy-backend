import type { IncomingMessage } from "node:http";

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

import {
    type BlacklistMatcher,
    callerMayReadRecipe,
    compileBlacklist,
    fetchRecipeSummary,
    RecipeSummary,
} from "../../recipes/services";

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
- Set "changes_method" to true ONLY when following the recipe's existing steps with this swap would go wrong — the technique itself has to change, not just the ingredient. Oil for butter in a pan sauce is false; oil for butter in a shortcrust is true, because the rubbing-in step no longer works. Omit it or use false for a straight swap. Most swaps are straight swaps, so this should be false far more often than true.

## Restrictions
The user turn may carry a BLACKLIST and DIETARY RESTRICTIONS. Both constrain what you may SUGGEST. Neither changes the dish, and neither is ever a reason to refuse an ingredient.
- Never name a blacklisted item as a substitute, in "name" or in "note". A blacklisted item rules out the forms of itself too: "butter" also rules out ghee and browned butter, "peanuts" also rules out peanut butter and groundnut oil.
- Never suggest a substitute that breaks a dietary restriction. These are absolute — a vegan cook gets no dairy swap, however well it would work in this dish.
- Both apply ONLY to what you suggest. Leave the recipe's own ingredients alone, including a restricted one the cook did not ask about: they asked what to use instead of one thing, not for the dish to be rewritten.
- When a restriction rules out the swap you would have given, give the best COMPLIANT swap instead. When it rules out every swap you can think of, say so in the note and offer the closest thing that does comply, or omitting it. Every requested ingredient still gets its line.

## Output Format
Output ONE JSON object per line (JSONL), one line per missing ingredient, in the SAME ORDER they were requested. No markdown, no code blocks, no extra text.

Each object must be:
{"ingredient_name": "<the ingredient name EXACTLY as requested>", "substitutes": [{"name": "...", "ratio": "...", "note": "...", "changes_method": false}]}`;

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

    // Before the missing list, never after it: that block ends with the
    // "in this order" instruction and the lines it governs, and anything
    // pushed between the two reads as part of the list.
    if (request.blacklist?.length) {
        lines.push("", `Blacklist: ${request.blacklist.join(", ")}`);
    }

    if (request.dietaryRestrictions?.length) {
        lines.push(
            "",
            `Dietary restrictions: ${request.dietaryRestrictions.join(", ")}`
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
 *
 * Exported because the use case has to count taste signals over the SAME list
 * this stream answers. Recording the raw request instead counts a collision
 * twice, and at `TASTE_SIGNAL_MIN_OCCURRENCES` of 2 that is one request minting
 * a standing preference on its own — which is the distinction
 * `profile_taste_signals` exists to draw.
 */
export const dedupeByName = (
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

/** The model returned no line for this ingredient at all. */
const NO_LINE_NOTE =
    "Try omitting it or using something of similar texture and flavour";

/** It returned lines, and the caller's restrictions ruled out every one. */
const ALL_BLOCKED_NOTE = "The usual swaps here clash with your restrictions";

/**
 * What is emitted for a requested ingredient with nothing left to offer —
 * either the model never returned a line for it, or everything it did return
 * was ruled out. The client sizes its loading skeletons by slicing its own
 * request list, so a gap leaves that ingredient's card missing with no
 * explanation once the stream ends — better to say plainly that nothing was
 * found than to invent culinary advice to fill the hole.
 *
 * The two notes are worth keeping apart: "we could not think of one" and "we
 * thought of several and you cannot eat any of them" are different answers, and
 * the second is the one a cook can act on by relaxing a setting.
 */
const buildFallback = (
    ingredient: MissingIngredientDto,
    note: string = NO_LINE_NOTE
): SubstituteSuggestionDto => ({
    ingredientName: ingredient.name,
    substitutes: [{ name: "No substitute suggested", note }],
});

/**
 * Maps one LLM line onto the wire shape, echoing back the name the client
 * ASKED for rather than the one the model returned — the client keys its cards
 * on `ingredientName` and title-cases it for display, so a model that reformats
 * "olive oil" as "Olive Oil" must not produce a card the client cannot line up
 * with its own request.
 *
 * Also where the blacklist is ENFORCED rather than merely asked for. The system
 * prompt carries the rule, and a prompt rule is not a gate — the same division
 * `FOOD_ONLY_RULE` draws against the authenticity gate. A swap the model should
 * not have offered dies here instead of being drawn on a card.
 *
 * **Scope of that enforcement, exactly:** the swap's NAME, by canonical id.
 * Not the `note`, which is prose — canonicalising it whole matches nothing, and
 * tokenising it would drop a good swap over "unlike butter, this will not
 * brown". And not the DIETARY restrictions, which would need the suggested name
 * resolved to an ingredient row before `dietary_properties` could be read, i.e.
 * a match pass per option. Both of those stay the prompt's half of the job;
 * this is the half that can be checked for free.
 */
const toSuggestion = (
    parsed: SubstituteSuggestionLlmDto,
    ingredient: MissingIngredientDto,
    blacklisted: BlacklistMatcher | null
): SubstituteSuggestionDto => {
    const allowed = parsed.substitutes.filter((option) => {
        if (!blacklisted || blacklisted([option.name]).length === 0) {
            return true;
        }

        console.warn(
            `[Substitutes] Dropping blacklisted swap "${option.name}" for "${ingredient.name}"`
        );

        return false;
    });

    if (allowed.length === 0) {
        return buildFallback(ingredient, ALL_BLOCKED_NOTE);
    }

    return {
        ingredientName: ingredient.name,
        substitutes: allowed.map((option) => ({
            name: option.name,
            ...(option.ratio ? { ratio: option.ratio } : {}),
            ...(option.note ? { note: option.note } : {}),
            // Only carried when true. Absent and false mean the same thing to
            // the client — no rewrite offered — so sending an explicit false on
            // every swap would spend wire bytes to say nothing.
            ...(option.changes_method ? { changesMethod: true } : {}),
        })),
    };
};

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
    provider?: LlmProvider,
    /**
     * The originating request, so an OWNED recipe (an import) only enriches its
     * own owner's prompt. Optional because the eval harness has no request —
     * and `callerMayReadRecipe` fails closed on one that is absent, so an eval
     * simply gets the un-enriched prompt rather than somebody's private recipe.
     */
    req?: IncomingMessage
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
    //
    // Which is exactly why an unreadable one is dropped rather than refused: an
    // owned recipe belongs to one profile, this read runs as the service role
    // and sees past the RLS enforcing that, and the graceful degradation is
    // already here. Somebody else's import contributes nothing to the prompt
    // instead of leaking its ingredient list through the answer.
    const summary = await fetchRecipeSummary(request.recipeId);
    const recipe = (await callerMayReadRecipe(summary?.createdBy, req))
        ? summary
        : null;

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

    // Compiled once for the whole stream. Exact canonical-id matching by
    // design — "butter" must not match "butternut squash" — which is also why
    // the rule is in the system prompt as well rather than only here: the model
    // is what covers the family cases ("butter" ruling out ghee) that an exact
    // match cannot see, and this is what covers the model ignoring the rule.
    const blacklisted = compileBlacklist(request.blacklist);

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

        resolved[index] = toSuggestion(line, requested[index], blacklisted);

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
