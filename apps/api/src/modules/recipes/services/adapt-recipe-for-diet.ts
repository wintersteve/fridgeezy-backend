import { generateStream } from "@fridgeezy/llm";
import {
    GenerateRecipeResponseDto,
    HeaderSchema,
    IngredientSchema,
    InstructionSchema,
    NutritionSchema,
    TipSchema,
} from "@fridgeezy/schemas";
import { RecipesRepository } from "@fridgeezy/supabase";
import { ingredientCanonicalId } from "@fridgeezy/toolkit";

import { AdaptationVerdict, runAdaptationGate } from "./adaptation-gate";
import { createRecipeStream } from "./create-recipe-stream";
import { fetchRecipe } from "./fetch-recipe";
import {
    fetchRecipeMetadata,
    formatTagsForPrompt,
    formatUnitsForPrompt,
} from "./fetch-recipe-metadata";
import {
    buildModifySystemPrompt,
    buildModifyUserPrompt,
} from "./modify-recipe-prompt";
import { persistRecipe } from "./persist-recipe";

/**
 * The near-miss card's counterpart: the dish, actually adapted, as a variant of
 * its own family.
 *
 * ## The whole flow, and the order is the design
 *
 * 1. **Gate** (`runAdaptationGate`) — two cheap calls deciding whether this
 *    dish survives the swap and what the swap is. Nothing is generated, written
 *    or claimed until this says yes.
 * 2. **Generate** — the shared modify prompt, whose "replace, never drop" rule
 *    is the difference between an adapted dish and a gutted one.
 * 3. **Verify** — the generated ingredient list is checked, in code, for the
 *    blocker. See below; this is the load-bearing step.
 * 4. **Persist** — as a variant, with the family in the INSERT.
 *
 * The gate runs FIRST for the same reason the review does in
 * `persistOrReuseSuggestion`: a refusal costs two small calls, and running it
 * afterwards would mean paying for a whole recipe before deciding to throw it
 * away.
 *
 * ## What "fails closed" means here, precisely
 *
 * There are two different bad outcomes and only one of them matters.
 *
 * *No adaptation is offered* is a disappointment. The reader sees the dish they
 * already saw on the near-miss card, still labelled with what stands in the
 * way. Nothing is claimed that was not true a moment earlier.
 *
 * *An unadapted recipe presented as adapted* is somebody cooking butter for a
 * dairy-free guest. So it is made structurally impossible rather than merely
 * unlikely: **the only path that writes a row and emits an id is the one that
 * has already confirmed the blocker is absent from the generated ingredient
 * list**, by canonical id, in code, after the model has finished. Every other
 * path — gate refusal, provider outage, generation failure, a rewrite that
 * quietly kept the ingredient, a persist error — leaves through a terminal
 * frame carrying `saved: false` and NO id.
 *
 * That matters because the id is the only thing the client can open. A frame
 * without one cannot be rendered as a recipe, so there is no shape in which a
 * caller ignoring `saved` still shows an unadapted dish as adapted; the worst a
 * confused client can do is show nothing. Compare `adaptRecipeForBlacklist`,
 * which has the same terminal-frame contract for the same reason but trusts the
 * prompt for the ingredient itself — acceptable there, where the blacklist is
 * also enforced at every other layer, and not acceptable here, where this is
 * the only check between a model's output and a dietary claim.
 *
 * ## Why the post-condition is not paranoia
 *
 * The modify prompt is told to keep the name and tags EXACTLY, and to change
 * only what the modification requires. A model that reads "replace the butter"
 * and emits a list still containing butter has done something the prompt
 * forbids — but prompts are not guarantees, and this particular failure is
 * silent, plausible-looking, and lands on a plate.
 */
export interface DietAdaptation {
    /** The family this adaptation was written into. */
    baseRecipeId: string;
    /** What the gate allowed: the swap, so the caller can name it. */
    substitute: string;
    stream: AsyncGenerator<unknown>;
}

/**
 * Why no adaptation is on offer. Returned INSTEAD of a stream, so a caller
 * cannot reach a stream without the gate having allowed one.
 */
export interface DietAdaptationRefused {
    refused: true;
    reason: Extract<AdaptationVerdict, { allowed: false }>["reason"];
    detail: string;
    retryable: boolean;
}

/**
 * "Dairy-free version", "Dairy-free and vegan version" — the label the client
 * saves the variant under and shows in the version selector.
 *
 * Names the DIET rather than the swap, unlike `adaptRecipeForBlacklist`'s
 * "Without peanuts". A blacklist is a personal exclusion, so naming the
 * excluded thing is the whole content of it; a diet is a category the reader
 * chose in Settings, and "Without butter" would not tell them why this version
 * exists among several.
 */
const deriveLabel = (diets: string[]): string => {
    const names = diets.map((diet) => diet.replace(/_/g, " ").toLowerCase());
    const joined =
        names.length <= 1
            ? (names[0] ?? "adapted")
            : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const label = `${joined.charAt(0).toUpperCase()}${joined.slice(1)} version`;

    return label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label;
};

export async function adaptRecipeForDiet({
    recipeId,
    blocker,
    diets,
}: {
    /** Any recipe in the family — the base is resolved from it. */
    recipeId: string;
    /** The single ingredient standing in the way, as the catalogue names it. */
    blocker: string;
    /** The diets the result must satisfy, readable ("dairy free"). */
    diets: string[];
}): Promise<DietAdaptation | DietAdaptationRefused | null> {
    const existingRecipe = await fetchRecipe(recipeId);

    if (!existingRecipe) {
        return null;
    }

    const ingredientNames = existingRecipe.ingredients.map((ing) => ing.name);
    const blockerId = ingredientCanonicalId(blocker);

    // The recipe has to actually contain it. A caller passing a blocker this
    // dish does not hold would otherwise get a "dairy-free version" generated
    // from a premise nobody checked — and the near-miss row it came from may
    // simply be stale, since the catalogue is shared and another user's
    // reclassification changes what blocks what.
    if (!ingredientNames.some((n) => ingredientCanonicalId(n) === blockerId)) {
        console.warn(
            `[AdaptDiet] "${existingRecipe.name}" does not contain "${blocker}" — refusing`
        );

        return {
            refused: true,
            reason: "no_substitute",
            detail: blocker,
            retryable: false,
        };
    }

    const verdict = await runAdaptationGate({
        name: existingRecipe.name,
        nameAlt: existingRecipe.nameEn,
        tags: existingRecipe.tags,
        ingredients: ingredientNames,
        blocker,
        diets,
    });

    if (!verdict.allowed) {
        return {
            refused: true,
            reason: verdict.reason,
            detail: verdict.detail,
            retryable: verdict.retryable,
        };
    }

    const repository = new RecipesRepository();
    const base = await repository.resolveVariantBase(recipeId);

    if (!base.success) {
        console.error(
            "[AdaptDiet] Failed to resolve the base recipe:",
            base.error.message
        );

        return null;
    }

    const baseRecipeId = base.value;
    const { substitute } = verdict;

    // Same dish, so the source's hero image still depicts it — and this skips
    // the slow, costly image model. The reasoning `modify` and
    // `adaptRecipeForBlacklist` both use.
    const existingImageUrl = (existingRecipe as { imageUrl?: string }).imageUrl;
    const label = deriveLabel(diets);

    const metadata = await fetchRecipeMetadata();
    const unitsPrompt = formatUnitsForPrompt(metadata.units);
    const tagsPrompt = formatTagsForPrompt(metadata.tags);

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "recipe.adapt-diet",
        system: buildModifySystemPrompt(unitsPrompt, tagsPrompt),
        user: buildModifyUserPrompt(
            existingRecipe,
            // The swap is NAMED rather than left to the model. The gate judged
            // this specific substitution and allowed the dish on that basis, so
            // generating a different one would be writing a recipe nothing
            // approved.
            `Replace the ${blocker} with ${substitute}. Adjust quantities, method and timings as that swap requires, and never reintroduce ${blocker} — not as an ingredient, not in a step, not as a garnish, seasoning, serving suggestion or tip. Change nothing else.`,
            diets
        ),
    });

    const recipeStream = createRecipeStream(stream, {
        schemas: [
            HeaderSchema,
            NutritionSchema,
            IngredientSchema,
            InstructionSchema,
            TipSchema,
        ],
        initialState: {
            name: existingRecipe.name, // MUST remain constant
            nameEn: existingRecipe.nameEn,
            difficulty: existingRecipe.difficulty,
            servings: existingRecipe.servings,
            tags: existingRecipe.tags, // MUST remain constant
        },
    });

    // Bound outside the generator: `existingRecipe` is narrowed to non-null
    // above, and that narrowing does not survive into the closure.
    const dishName = existingRecipe.name;

    async function* streamWithPersist(): AsyncGenerator<unknown> {
        let finalRecipe: GenerateRecipeResponseDto | undefined;

        for await (const frame of recipeStream) {
            if (
                frame &&
                typeof frame === "object" &&
                (frame as { type?: string }).type === "complete"
            ) {
                finalRecipe = (frame as { recipe: GenerateRecipeResponseDto })
                    .recipe;
                // Held back and re-emitted below, so the client's done-detector
                // only ever fires on a frame this function has vetted.
                continue;
            }

            yield frame;
        }

        if (!finalRecipe) {
            yield { type: "complete", saved: false, reason: "generation_failed" };
            return;
        }

        // THE post-condition. Everything above is a request; this is the only
        // thing that has looked at what came back. See the header.
        const stillPresent = finalRecipe.ingredients.some(
            (ing) => ingredientCanonicalId(ing.name) === blockerId
        );

        if (stillPresent) {
            console.error(
                `[AdaptDiet] Rewrite of "${dishName}" still contains "${blocker}" — refusing to persist`
            );
            yield { type: "complete", saved: false, reason: "swap_not_applied" };
            return;
        }

        const persistResult = await persistRecipe(
            finalRecipe,
            existingImageUrl,
            baseRecipeId
        );

        if (!persistResult.success) {
            console.error(
                "[AdaptDiet] Failed to persist the adapted recipe:",
                persistResult.error.message
            );
            yield { type: "complete", saved: false, reason: "persist_failed" };
            return;
        }

        yield {
            type: "complete",
            saved: true,
            id: persistResult.value,
            label,
            image: existingImageUrl,
            // What was actually done, for copy that may promise exactly this
            // much and no more — see the route's own note.
            swapped: { from: blocker, to: substitute },
            recipe: { ...finalRecipe, id: persistResult.value },
        };
    }

    return { baseRecipeId, substitute, stream: streamWithPersist() };
}
