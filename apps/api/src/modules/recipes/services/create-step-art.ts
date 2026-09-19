import {
    buildFoodIllustrationStyle,
    encodeRecipeImageVariants,
    generateImage,
} from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

/**
 * Per-step illustrations for cook mode, generated once per recipe as a batch.
 *
 * ## It is OFF, and off is the honest default
 *
 * `RECIPE_STEP_ART_ENABLED` is unset everywhere. This is the single most
 * expensive thing the app could generate: a recipe has six to twelve steps, so
 * at the image model's ~$0.067 a render that is **$0.40-$0.80 per recipe**,
 * against ~$0.067 for the hero it already pays for. Ten times the art budget,
 * for pictures a reader only sees if they cook the dish with cook mode open.
 *
 * The client half is off independently, under `RECIPE_STEP_ART_ENABLED` in
 * `core/config/flags.ts`. Both, or neither — on alone, this writes objects
 * nothing reads; the client alone asks for objects that were never written.
 * That is the arrangement `TASTE_PROFILE_ENABLED` already documents.
 *
 * ## Why a batch, and why after creation
 *
 * The alternative is drawing a step the first time somebody opens it, which is
 * how technique art works and is wrong here for two reasons. A cook is standing
 * at a hob: twelve seconds of nothing while a step renders is the one moment
 * the app cannot ask anybody to wait. And a reader who abandons a recipe at
 * step three has paid for three renders that nothing will ever show again,
 * where a batch either draws a method or does not.
 *
 * So it fires once, from the point the recipe is persisted and its steps
 * therefore exist, as a tracked background task — the same treatment the hero
 * gets, and the same reason: Lambda must be allowed to finish it before the
 * environment freezes.
 *
 * ## What it deliberately does not do
 *
 * It does not retry, it does not queue, and it does not resume. A step whose
 * render fails simply has no picture, and `CookArt` draws nothing for a step
 * with no picture — which is what every step looks like today. Anything more
 * durable than that is a job runner, and a job runner is a decision to make
 * when the switch is turned on rather than while it is off.
 */
const BUCKET = "recipe_step_art";

/**
 * Off unless explicitly enabled. Read at call time rather than at module scope
 * so a deployment can flip it without a rebuild, and so a test can set it.
 */
const isEnabled = () => process.env.RECIPE_STEP_ART_ENABLED === "true";

/**
 * How many renders run at once.
 *
 * Three rather than all of them: a twelve-step recipe firing twelve concurrent
 * image calls is a burst big enough to hit a provider rate limit, and the whole
 * batch is already off the reader's critical path — nothing is waiting on it,
 * so there is no reason to spend burst capacity to finish sooner.
 */
const CONCURRENCY = 3;

/** `<recipe_id>/<step_number>.webp` — see the bucket's migration for the key. */
const storagePath = (recipeId: string, stepNumber: number): string =>
    `${recipeId}/${stepNumber}.webp`;

export const recipeStepArtPublicUrl = (
    recipeId: string,
    stepNumber: number,
): string =>
    toDeviceReachable(
        supabaseAdmin.storage
            .from(BUCKET)
            .getPublicUrl(storagePath(recipeId, stepNumber)).data.publicUrl,
    );

interface Step {
    step_number: number;
    title: string | null;
    instruction_text: string;
}

/**
 * The subject half of the prompt.
 *
 * It describes the STEP's result rather than the finished dish — "the pan after
 * this instruction", not "the recipe". A step picture that shows the plated
 * dish is the hero again, twelve times over.
 *
 * The house art direction is used unmodified here, unlike the technique plates:
 * those had to name their ingredients and show a tool because they answer "what
 * does this word mean", where these sit above a sentence that already says what
 * is happening and to what. The band is atmosphere for a cook who is reading,
 * not a definition.
 */
const buildStepPrompt = (dish: string, step: Step): string =>
    `Editorial illustration of one moment in cooking ${dish}.

SUBJECT
- The state of the food at the END of this instruction, in whatever vessel the instruction implies: ${step.instruction_text}
- It shows only what this step produced — not the finished dish, not a later step, and not a plated portion unless this step is the plating.
- ONE vessel, centred, and nothing else in the picture.
- This is ONE single continuous illustration of ONE moment, never a grid, sequence, panel or set of steps.

${buildFoodIllustrationStyle({
    framing:
        "the vessel is centred and fills about two thirds of the frame's width, leaving a generous even margin of empty ground on all four sides. Nothing is cropped by an edge.",
    mood: "mid-method — one moment of a dish being made.",
})}`;

const renderStep = async (
    recipeId: string,
    dish: string,
    step: Step,
): Promise<boolean> => {
    try {
        const { base64Data } = await generateImage({
            prompt: buildStepPrompt(dish, step),
            // 4:3, matching the band cook mode draws these in — see
            // `COOK_ART_BLEED_HEIGHT`, which is picked against that ratio.
            aspectRatio: "4:3",
        });

        if (!base64Data) return false;

        // The hero's encoder, for its WebP settings. The `card` variant and the
        // thumbhash it also produces are discarded: a step band has one size
        // and no placeholder of its own, so writing either would be an upload
        // nothing asks for.
        const { hero } = await encodeRecipeImageVariants(
            Buffer.from(base64Data, "base64"),
        );

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath(recipeId, step.step_number), hero, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, NOT a header — supabase-js prefixes `max-age=`.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(
                `[stepArt] ${recipeId}/${step.step_number}: ${error.message}`,
            );

            return false;
        }

        return true;
    } catch (error) {
        console.error(`[stepArt] ${recipeId}/${step.step_number}:`, error);

        return false;
    }
};

/**
 * Draw every step of a recipe, once.
 *
 * Returns immediately and does nothing at all when the switch is off, which is
 * what makes it safe to call unconditionally from the generation path.
 */
export async function generateRecipeStepArt(recipeId: string): Promise<void> {
    if (!isEnabled()) return;

    const { data: recipe, error: recipeError } = await supabaseAdmin
        .from("recipes")
        .select("name")
        .eq("id", recipeId)
        .maybeSingle();

    if (!recipe || recipeError) {
        console.error(`[stepArt] no recipe ${recipeId}:`, recipeError);

        return;
    }

    const { data: steps, error: stepsError } = await supabaseAdmin
        .from("recipe_instructions")
        .select("step_number, title, instruction_text")
        .eq("recipe_id", recipeId)
        .order("step_number");

    if (!steps?.length || stepsError) {
        console.error(`[stepArt] no steps for ${recipeId}:`, stepsError);

        return;
    }

    console.log(
        `[stepArt] ${recipe.name}: drawing ${steps.length} steps (~$${(
            steps.length * 0.067
        ).toFixed(2)})`,
    );

    const queue = [...steps];
    let drawn = 0;

    // A fixed pool rather than chunked `Promise.all`: chunking makes every
    // worker wait for the slowest render in its chunk, and these vary by
    // seconds.
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let step = queue.shift(); step; step = queue.shift()) {
            if (await renderStep(recipeId, recipe.name, step)) drawn++;
        }
    });

    await Promise.all(workers);

    console.log(`[stepArt] ${recipe.name}: ${drawn}/${steps.length} drawn`);
}
