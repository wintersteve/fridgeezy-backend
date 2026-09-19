// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";

import { buildRecipeImagePrompt, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Renders recipe hero art to a folder so a change can be LOOKED AT before it
 * reaches the catalogue.
 *
 * ## Why this did not exist and had to
 *
 * Every art-direction decision on record was reached by rendering candidates
 * and picking one — the camera ladder at 0/15/30/45 degrees, the 18-render
 * medium comparison, the five-dish blind model A/B. None of those had a script:
 * they were run by hand, so the sweeps are recorded in comments and cannot be
 * re-run. Meanwhile the only way to see what the SHIPPING prompt does to a dish
 * was to let the API generate one, which writes to storage and gives a
 * catalogue row a picture.
 *
 * ## It renders the exported prompt, never a copy
 *
 * `buildRecipeImagePrompt` moved into `@fridgeezy/genai` for this. A harness
 * holding its own paragraph would drift from the shipping one exactly as the
 * two style blocks did before `buildFoodIllustrationStyle` was extracted — and
 * it would drift in the worst possible direction, since its whole purpose is to
 * predict what the app will draw. If this file ever contains prompt prose, it
 * has stopped being a harness.
 *
 * ## It does not upload, and must not learn how
 *
 * `generateAndUploadRecipeImage` short-circuits on an existing object at the
 * dish's deterministic path, so re-rendering a dish that already has art is not
 * something the app can do — deliberately, because a dish's picture is
 * established and silently changing it is worse than leaving a mediocre one up.
 * Two further traps make "just delete the object first" wrong as well: a dish
 * whose art predates the WebP pipeline has a legacy `.png`, and deleting the
 * webp pair makes the next request CONVERT that PNG rather than render
 * anything; and the row's `image` column is a predicted URL, so a half-deleted
 * pair points at an extension nothing wrote. Installing a winner is therefore a
 * deliberate, separate act — see the closing note this prints.
 *
 * ## The model axis
 *
 * `generateImage` resolves its default from `GENAI_IMAGE_MODEL`, so comparing
 * two models by setting that variable means two processes and two prompts built
 * at two moments. This passes `model` per call instead, so a row of renders
 * differs in exactly one thing.
 *
 * Usage:
 *   npx jiti operations/render-recipe-art.ts
 *   npx jiti operations/render-recipe-art.ts --dishes="Moussaka,Toum" --reps=2
 *   npx jiti operations/render-recipe-art.ts --models=gemini-3-pro-image
 *   npx jiti operations/render-recipe-art.ts --dishes="Sticky Rice" --ingredients
 *   npx jiti operations/render-recipe-art.ts --reference=one.webp,two.jpg
 */

type Model = NonNullable<Parameters<typeof generateImage>[0]["model"]>;

/**
 * The default three are the 2026-09-18 rejects whose faults are things the
 * prompt already forbids at length — an overhead bowl, a flat un-toothed fill,
 * a glaze rendered matte. That is the signature of a model not complying rather
 * than of a prompt that says too little, which is the question the default run
 * is asking.
 */
const DEFAULT_DISHES = ["Teriyaki Salmon", "Shrimp Risotto", "French Omelette"];

/**
 * Current default first, then the variant the shipping prompt was actually
 * tuned on. `generate-image`'s own note says the 3.1 default is untested
 * against this art direction; this is the test.
 */
const DEFAULT_MODELS: Model[] = [
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
];

const arg = (name: string) =>
    process.argv
        .find((a) => a.startsWith(`--${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");

const list = (value: string | undefined) =>
    value
        ?.split(",")
        .map((part) => part.trim())
        .filter(Boolean);

const DISHES = list(arg("dishes")) ?? DEFAULT_DISHES;
const MODELS = (list(arg("models")) as Model[] | undefined) ?? DEFAULT_MODELS;
const REPS = Number(arg("reps") ?? 1);

/**
 * Pass each dish's own ingredients into the prompt — the second axis this
 * harness can vary, and the one that is a real prompt change rather than a
 * model swap.
 *
 * It renders into its own directory so a with/without pair can be looked at
 * side by side; the prompt's own parameter is inert without it, so the two
 * directories differ in exactly the clause under test.
 */
const WITH_INGREDIENTS = process.argv.includes("--ingredients");

/**
 * A picture the model is shown as the house style — the third axis, and the
 * only one that is not words.
 *
 * It is read once, at startup, so a run that cannot find the file fails before
 * spending anything rather than a third of the way through a sweep.
 */
const REFERENCES = list(arg("reference")) ?? [];

/**
 * Names the vessel outright — for making an anchor of a vessel the set has no
 * example of yet. See `buildRecipeImagePrompt`'s `vessel`, which holds the
 * reason; this is the only axis here that is a string rather than a switch, and
 * it is the operator's words rather than the file's.
 */
const VESSEL = arg("vessel");

/** The mime types these models take, keyed by the extension on disk. */
const MIME_BY_EXTENSION: Record<string, string> = {
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
};

/**
 * Read at startup, so a run that cannot find a file fails before spending
 * anything rather than a third of the way through a sweep.
 */
const referenceImages = REFERENCES.length
    ? REFERENCES.map((path) => ({
          data: readFileSync(
              isAbsolute(path) ? path : join(process.cwd(), path)
          ).toString("base64"),
          mimeType: MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "image/jpeg",
      }))
    : undefined;

/**
 * The recipe's ingredient names, in the order the recipe lists them.
 *
 * By NAME, because that is all the harness is given and all the prompt wants.
 * A dish with several difficulty rungs has several rows and they share one
 * picture, so the first row is as good as any — this is asking what the dish is
 * made of, not what one rung's version measures out.
 */
async function ingredientsFor(dish: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("recipe_ingredients(ingredients(name))")
        .eq("name", dish)
        .limit(1);

    if (error || !data?.length) {
        console.warn(
            `  (no recipe row for ${dish} — rendering without ingredients)`
        );
        return [];
    }

    return (data[0].recipe_ingredients ?? [])
        .map((row) => row.ingredients?.name)
        .filter((name): name is string => Boolean(name));
}

const OUT_DIR = join(process.cwd(), "operations", "output", "recipe-art");

/** Mirrors `create-recipe-image`'s storage naming, so a file is findable by dish. */
const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

async function main() {
    console.log("=== Recipe hero art ===\n");
    console.log(`Dishes: ${DISHES.join(", ")}`);
    console.log(`Models: ${MODELS.join(", ")}`);
    console.log(
        `Ingredients in the prompt: ${WITH_INGREDIENTS ? "yes" : "no"}`
    );
    console.log(
        `Style references: ${REFERENCES.length ? REFERENCES.join(", ") : "none"}`
    );
    if (VESSEL) console.log(`Vessel forced: ${VESSEL}`);
    console.log(`Renders: ${DISHES.length * MODELS.length * REPS}\n`);

    const written: { model: string; dish: string; file: string }[] = [];
    let failed = 0;

    for (const model of MODELS) {
        // The suffixes compose, so a cell is identifiable from its directory
        // alone — which is the whole point of a sweep somebody has to look at.
        const dir = join(
            OUT_DIR,
            `${model}${WITH_INGREDIENTS ? "-ingredients" : ""}${
                REFERENCES.length ? `-ref${REFERENCES.length}` : ""
            }${VESSEL ? "-vessel" : ""}`
        );
        mkdirSync(dir, { recursive: true });

        for (const dish of DISHES) {
            // Once per dish, not once per roll: the answer cannot change
            // between two rolls of the same dish.
            const ingredients = WITH_INGREDIENTS
                ? await ingredientsFor(dish)
                : [];

            for (let rep = 1; rep <= REPS; rep++) {
                const label = `${model} · ${dish}${REPS > 1 ? ` (${rep})` : ""}`;

                try {
                    console.log(`Generating ${label}...`);

                    // The 3:4 the client crops three ways — see the framing note
                    // on the prompt. Rendering square here would measure a
                    // composition the app never asks for.
                    const { base64Data, mimeType } = await generateImage({
                        prompt: buildRecipeImagePrompt(dish, ingredients, {
                            styleReferences: REFERENCES.length,
                            ...(VESSEL ? { vessel: VESSEL } : {}),
                        }),
                        referenceImages,
                        model,
                        aspectRatio: "3:4",
                    });

                    if (!base64Data) {
                        throw new Error(
                            `No image data for ${dish} — the prompt likely produced a text response.`
                        );
                    }

                    const file = `${slugify(dish)}${rep > 1 ? `-${rep}` : ""}.${extensionFor(mimeType)}`;
                    writeFileSync(
                        join(dir, file),
                        Buffer.from(base64Data, "base64")
                    );
                    written.push({ model, dish, file });
                    console.log(`✓ ${dir.split("/").pop()}/${file}`);
                } catch (error) {
                    failed++;
                    console.error(
                        `✗ ${label}: ${error instanceof Error ? error.message : error}`
                    );
                }

                // Same spacing as the other image operations.
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    // A record of what was rendered against what, beside the pictures. Two
    // renders of one dish are indistinguishable once they are files in a
    // folder, and the whole value of a comparison is knowing which is which.
    writeFileSync(
        join(OUT_DIR, "manifest.json"),
        JSON.stringify(
            {
                renderedAt: new Date().toISOString(),
                models: MODELS,
                dishes: DISHES,
                reps: REPS,
                ingredients: WITH_INGREDIENTS,
                references: REFERENCES,
                written,
            },
            null,
            2
        )
    );

    console.log(`\nWritten to ${OUT_DIR}`);
    console.log(
        "\nNothing was uploaded and no catalogue row changed. To install a winner " +
            "a dish's existing objects have to be replaced deliberately — read this " +
            "file's header before doing it."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
