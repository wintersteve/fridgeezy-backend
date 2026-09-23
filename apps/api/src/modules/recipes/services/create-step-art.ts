import {
    buildMiseArtPrompt,
    buildStepArtPrompt,
    encodeRecipeImageVariants,
    generateImage,
    type MiseReference,
} from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

import { fetchMiseAnchor } from "./style-anchors";

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
 *
 * ## Two callers, one pool
 *
 * {@link generateRecipeStepArt} is the AUTOMATIC path and keeps the flag.
 * {@link renderRecipeStepArt} is the same work with the flag question removed,
 * for the admin console — which is the manual path, and whose whole premise is
 * that spending $0.40-$0.80 on a dish is "a decision a person makes about a
 * dish rather than a flag a deployment sets" (`generate-step-art.ts`, which
 * makes the same argument from the command line).
 *
 * That is why the console is not gated on `RECIPE_STEP_ART_ENABLED` and must
 * not become so: the flag decides whether art is drawn AUTOMATICALLY for every
 * dish the app writes. It has never decided whether art may be SHOWN — the
 * client draws whatever is in the bucket — and a console that honoured it
 * would be a button that silently does nothing, on the one surface built for
 * somebody to spend money on purpose.
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

/**
 * The gathering page's slot.
 *
 * A method's steps are numbered from 1, so a string cannot collide with one —
 * and the same sentinel is what `generate-step-art.ts` already uses
 * (`type Slot = number | typeof MISE`). Sharing the vocabulary is what keeps
 * one object key meaning one thing across the two callers.
 */
export const MISE_SLOT = "mise" as const;

export type StepArtSlot = number | typeof MISE_SLOT;

/** `<recipe_id>/<slot>.webp` — see the bucket's migration for the key. */
const storagePath = (recipeId: string, slot: StepArtSlot): string =>
    `${recipeId}/${slot}.webp`;

export const recipeStepArtPublicUrl = (
    recipeId: string,
    slot: StepArtSlot,
): string =>
    toDeviceReachable(
        supabaseAdmin.storage
            .from(BUCKET)
            .getPublicUrl(storagePath(recipeId, slot)).data.publicUrl,
    );

interface Step {
    step_number: number;
    title: string | null;
    instruction_text: string;
}

/**
 * The dish's own hero, as a reference image, or null.
 *
 * Attached to a gathering page for one thing only: what THIS dish's
 * ingredients look like — their colour, their gloss, how wet or dry they are.
 * `miseReferenceClause` spends most of its words telling the model not to take
 * the plating, because a finished dish is a powerful subject magnet and this
 * picture is the bench before any cooking.
 *
 * Never throws. A hero that cannot be fetched costs the gathering page its
 * colour reference, which is what every one drawn before references existed
 * had — not its existence.
 */
const loadHeroReference = async (
    image: string | null,
): Promise<{ data: string; mimeType: string } | null> => {
    if (!image) return null;

    try {
        const response = await fetch(image);

        if (!response.ok) {
            console.warn(`[stepArt] hero fetch ${response.status} — drawing unanchored`);

            return null;
        }

        return {
            data: Buffer.from(await response.arrayBuffer()).toString("base64"),
            // From the stored URL's extension rather than the response header:
            // the bucket serves webp and the models take it, but a CDN in front
            // of storage can answer application/octet-stream, which they do not.
            mimeType: image.endsWith(".png") ? "image/png" : "image/webp",
        };
    } catch (error) {
        console.warn("[stepArt] hero fetch failed — drawing unanchored", error);

        return null;
    }
};

/**
 * The GATHERING PAGE: every ingredient in its own bowl, before any cooking.
 *
 * Not a step, and that is the whole reason it needs its own function rather
 * than a branch: it has no `recipe_instructions` row, no number, and a
 * different prompt with different reference images. What it shares with a step
 * is the bucket, the key shape and the encoder.
 *
 * **Two references, and the order is load-bearing.** `generateImage` puts
 * reference images before the text in ARRAY ORDER, so the clause's "the FIRST"
 * and "the SECOND" are claims about the payload rather than labels — which is
 * why the list of names and the list of images are built from the same
 * condition, exactly as `generate-step-art.ts` does it.
 */
const renderMise = async (
    recipeId: string,
    dish: string,
    ingredients: string[],
    heroUrl: string | null,
): Promise<boolean> => {
    try {
        const [anchor, hero] = await Promise.all([
            fetchMiseAnchor(),
            loadHeroReference(heroUrl),
        ]);

        const references: MiseReference[] = [
            ...(anchor ? (["gathering"] as const) : []),
            ...(hero ? (["hero"] as const) : []),
        ];

        const images = [
            ...(anchor ? [anchor] : []),
            ...(hero ? [hero] : []),
        ];

        const { base64Data } = await generateImage({
            prompt: buildMiseArtPrompt(dish, ingredients, { references }),
            ...(images.length > 0 && { referenceImages: images }),
            aspectRatio: "4:3",
        });

        if (!base64Data) return false;

        const { hero: encoded } = await encodeRecipeImageVariants(
            Buffer.from(base64Data, "base64"),
        );

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath(recipeId, MISE_SLOT), encoded, {
                contentType: "image/webp",
                upsert: true,
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`[stepArt] ${recipeId}/mise: ${error.message}`);

            return false;
        }

        return true;
    } catch (error) {
        console.error(`[stepArt] ${recipeId}/mise:`, error);

        return false;
    }
};

/**
 * The dish's ingredient NAMES, for the gathering page's prompt.
 *
 * Names only. `buildMiseArtPrompt`'s own note gives the reason: servings are
 * adjustable in the app, so a picture drawn around "two cucumbers" is wrong for
 * everybody who changed the number — and the gathering page is glanced at for
 * WHAT is needed, which the recipe's own list beneath it already quantifies.
 */
const fetchIngredientNames = async (recipeId: string): Promise<string[]> => {
    const { data, error } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("ingredients(name)")
        .eq("recipe_id", recipeId);

    if (error) {
        console.error(`[stepArt] could not read ingredients for ${recipeId}`, error);

        return [];
    }

    return (data ?? [])
        .map((row) => row.ingredients?.name)
        .filter((name): name is string => Boolean(name));
};

const renderStep = async (
    recipeId: string,
    dish: string,
    step: Step,
): Promise<boolean> => {
    try {
        const { base64Data } = await generateImage({
            prompt: buildStepArtPrompt(dish, step.instruction_text),
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

/** What one slot's render did, for a caller that is waiting on it. */
export interface StepArtResult {
    /** A step number, or `"mise"` for the gathering page. */
    slot: StepArtSlot;
    drawn: boolean;
    /** Present when the slot was skipped because a picture was already there. */
    skipped?: boolean;
}

export interface RenderStepArtOptions {
    /**
     * Only these step numbers. Omitted means every step.
     *
     * The console's per-slot redraw, and the `--steps=3,7` the command-line
     * operation already takes: a method where one picture came out wrong is
     * the common case, and redrawing twelve to fix one is eleven renders of
     * waste. `"mise"` is a slot here like any number.
     */
    slots?: StepArtSlot[];
    /**
     * Redraw a step that already has a picture.
     *
     * Default false, which is the opposite of what this function did when it
     * had one caller. `renderStep` uploads with `upsert: true` and never looked
     * at what was there, so the automatic path always paid full price — safe
     * while it only ever fired once per recipe at creation, and wrong the
     * moment a human can press the button twice.
     */
    force?: boolean;
}

/**
 * Draw a recipe's step pictures and report what happened, ignoring the flag.
 *
 * The shared implementation. See the header for why the console reaches this
 * rather than {@link generateRecipeStepArt}.
 */
export async function renderRecipeStepArt(
    recipeId: string,
    { slots, force = false }: RenderStepArtOptions = {},
): Promise<{ dish: string; results: StepArtResult[] } | null> {
    const { data: recipe, error: recipeError } = await supabaseAdmin
        .from("recipes")
        .select("name, image")
        .eq("id", recipeId)
        .maybeSingle();

    if (!recipe || recipeError) {
        console.error(`[stepArt] no recipe ${recipeId}:`, recipeError);

        return null;
    }

    const { data: allSteps, error: stepsError } = await supabaseAdmin
        .from("recipe_instructions")
        .select("step_number, title, instruction_text")
        .eq("recipe_id", recipeId)
        .order("step_number");

    if (!allSteps?.length || stepsError) {
        console.error(`[stepArt] no steps for ${recipeId}:`, stepsError);

        return null;
    }

    /*
      Every slot this recipe HAS, gathering page first.

      Mise leads because that is the order a cook meets them — the bench before
      step one — and because the list is what the console draws in order.
    */
    const everySlot: StepArtSlot[] = [
        MISE_SLOT,
        ...allSteps.map((step) => step.step_number),
    ];

    const wanted = slots?.length
        ? everySlot.filter((slot) => slots.includes(slot))
        : everySlot;

    // One listing for the whole recipe rather than a probe per step — the same
    // shape `recipe-art.ts` uses for hero images, and the reason is the same:
    // membership for every step costs one request.
    const existing = new Set<string>();

    if (!force) {
        const { data: objects } = await supabaseAdmin.storage
            .from(BUCKET)
            .list(recipeId, { limit: 1000 });

        for (const object of objects ?? []) existing.add(object.name);
    }

    const toDraw = wanted.filter(
        (slot) => force || !existing.has(`${slot}.webp`),
    );

    const results: StepArtResult[] = wanted
        .filter((slot) => !toDraw.includes(slot))
        .map((slot) => ({ slot, drawn: false, skipped: true }));

    if (toDraw.length) {
        console.log(
            `[stepArt] ${recipe.name}: drawing ${toDraw.length} step(s) (~$${(
                toDraw.length * 0.067
            ).toFixed(2)})`,
        );
    }

    // Only read when the gathering page is actually being drawn: it is a
    // second query and every other slot ignores it.
    const ingredients = toDraw.includes(MISE_SLOT)
        ? await fetchIngredientNames(recipeId)
        : [];

    const queue = [...toDraw];

    // A fixed pool rather than chunked `Promise.all`: chunking makes every
    // worker wait for the slowest render in its chunk, and these vary by
    // seconds.
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let slot = queue.shift(); slot !== undefined; slot = queue.shift()) {
            const drawn =
                slot === MISE_SLOT
                    ? await renderMise(
                          recipeId,
                          recipe.name,
                          ingredients,
                          recipe.image,
                      )
                    : await renderStep(
                          recipeId,
                          recipe.name,
                          allSteps.find(
                              (step) => step.step_number === slot,
                          ) as Step,
                      );

            results.push({ slot, drawn });
        }
    });

    await Promise.all(workers);

    // Mise first, then steps in order — the order a cook meets them.
    const rank = (slot: StepArtSlot) => (slot === MISE_SLOT ? -1 : slot);

    results.sort((a, b) => rank(a.slot) - rank(b.slot));

    console.log(
        `[stepArt] ${recipe.name}: ${results.filter((r) => r.drawn).length}/${wanted.length} drawn`,
    );

    return { dish: recipe.name, results };
}

/**
 * Draw every step of a recipe, once.
 *
 * Returns immediately and does nothing at all when the switch is off, which is
 * what makes it safe to call unconditionally from the generation path.
 */
export async function generateRecipeStepArt(recipeId: string): Promise<void> {
    if (!isEnabled()) return;

    // `force` stays false: this fires once from the persistence path, so a
    // picture that is already there belongs to a dish written earlier under the
    // same id and is not worth paying for twice.
    await renderRecipeStepArt(recipeId);
}

