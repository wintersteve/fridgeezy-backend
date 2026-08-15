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
 * A version of an existing recipe with the caller's blacklisted ingredients
 * swapped out, stored as a VARIANT of that recipe's family.
 *
 * ## When this runs, and why it is not just "modify"
 *
 * Promotion has two reuse shortcuts, and both can land on a catalogue recipe the
 * caller cannot eat. One of them — `findBySuggestionId` — fires *after* the
 * suggestion has been deleted, so there is no adapted ingredient list to
 * generate from and no way to fall through to ordinary generation. The only
 * source material left is the recipe itself, which makes this a modification
 * with the instruction written for it rather than by the user.
 *
 * It is deliberately the same prompt `POST /recipes/modify` uses. The system
 * prompt already carries the rule that matters here — *replace* a
 * non-compliant ingredient with an authentic substitute rather than dropping it
 * — and that rule is the difference between an adapted dish and the gutted one
 * `GUTTED_DISHES` pins in the authenticity eval: strip the seafood from a
 * ceviche and what is left is a plate of garnishes wearing a real dish's name.
 *
 * ## Why a variant and not a new base
 *
 * It is the same dish under the same name at the same difficulty, so a base row
 * is what `recipes_canonical_id_difficulty_unique` rejects — and rightly:
 * discovery would then show two indistinguishable copies. The lineage goes into
 * the INSERT (never patched on afterwards) for the reason recorded on
 * `RecipesRepository.persist`.
 *
 * ## What the caller must do with `label`
 *
 * The row is an unsaved variant until the client links it in `recipe_variants`,
 * exactly like the output of modify. The terminal frame carries a `label` for
 * that save; a client that ignores it leaves a recipe the orphan sweep may
 * eventually reap.
 */
export interface BlacklistAdaptation {
    /** The family this adaptation was written into. */
    baseRecipeId: string;
    stream: AsyncGenerator<unknown>;
}

/**
 * "Without peanuts", "Without peanuts and shellfish" — the label the client
 * saves the variant under, and the one it shows in the version selector.
 *
 * Built from the names the USER wrote rather than the recipe's spelling of
 * them: this label is read back by the person who typed the blacklist.
 */
const deriveLabel = (offending: string[]): string => {
    const names = offending.map((name) => name.toLowerCase());
    const joined =
        names.length <= 1
            ? (names[0] ?? "the excluded ingredient")
            : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const label = `Without ${joined}`;

    return label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label;
};

export async function adaptRecipeForBlacklist({
    recipeId,
    blacklist,
    offending,
}: {
    /** Any recipe in the family — the base is resolved from it. */
    recipeId: string;
    /** The caller's full blacklist, as the prompt's standing restriction. */
    blacklist: string[];
    /** The subset this recipe actually contains, for the label. */
    offending: string[];
}): Promise<BlacklistAdaptation | null> {
    const existingRecipe = await fetchRecipe(recipeId);

    if (!existingRecipe) {
        return null;
    }

    const repository = new RecipesRepository();
    const base = await repository.resolveVariantBase(recipeId);

    if (!base.success) {
        console.error(
            "Failed to resolve the adapted recipe's base:",
            base.error.message
        );
        return null;
    }

    const baseRecipeId = base.value;

    // The source recipe's hero image. Same dish, so it still depicts it, and
    // this skips the slow, costly image model — the same reasoning modify uses.
    const existingImageUrl = (existingRecipe as { imageUrl?: string }).imageUrl;
    const label = deriveLabel(offending);

    const metadata = await fetchRecipeMetadata();
    const unitsPrompt = formatUnitsForPrompt(metadata.units);
    const tagsPrompt = formatTagsForPrompt(metadata.tags);

    const stream = generateStream({
        model: { openai: "gpt-4.1" },
        label: "recipe.adapt-blacklist",
        system: buildModifySystemPrompt(unitsPrompt, tagsPrompt),
        user: buildModifyUserPrompt(
            existingRecipe,
            `The cook cannot eat ${blacklist.join(", ")}. Replace every one of those that appears in this recipe with an authentic substitute, and never reintroduce one — not as an ingredient, not in a step, not as a garnish, seasoning, serving suggestion or tip.`,
            blacklist
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
                // Held back; re-emitted below once the row exists, so the
                // client's done-detector fires on a frame that carries the id.
                continue;
            }

            yield frame;
        }

        if (!finalRecipe) {
            yield { type: "complete", saved: false };
            return;
        }

        const persistResult = await persistRecipe(
            finalRecipe,
            existingImageUrl,
            baseRecipeId
        );

        if (!persistResult.success) {
            console.error(
                "Failed to persist the blacklist-adapted recipe:",
                persistResult.error.message
            );
            // Terminal frame with no id: the caller must NOT fall back to the
            // recipe this was adapting away from — that is the one the user
            // cannot eat.
            yield { type: "complete", saved: false };
            return;
        }

        yield {
            type: "complete",
            saved: true,
            id: persistResult.value,
            label,
            image: existingImageUrl,
            recipe: { ...finalRecipe, id: persistResult.value },
        };
    }

    return { baseRecipeId, stream: streamWithPersist() };
}
