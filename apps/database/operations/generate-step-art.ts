import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    buildMiseArtPrompt,
    buildStepArtPrompt,
    encodeRecipeImageVariants,
    generateImage,
    isVertexConfigured,
    MiseReference,
} from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Draw per-step illustrations for CHOSEN dishes, by hand, one dish at a time.
 *
 *   npx nx run @fridgeezy/database:generate-step-art -- --dishes="Moussaka" --dry-run
 *   npx nx run @fridgeezy/database:generate-step-art -- --dishes="Moussaka"
 *   npx nx run @fridgeezy/database:generate-step-art -- --ids=<uuid> --steps=3,7 --force
 *   npx nx run @fridgeezy/database:generate-step-art -- --dishes="Moussaka" --steps=mise
 *
 * ## Why this exists at all
 *
 * `generateRecipeStepArt` in `apps/api` is the same pictures drawn on the
 * generation path, and it is gated behind `RECIPE_STEP_ART_ENABLED`, which is
 * unset everywhere — its own note gives the arithmetic: six to twelve steps at
 * ~$0.067 a render is $0.40-$0.80 per recipe against ~$0.067 for the hero, ten
 * times the art budget for pictures only a cook in cook mode ever sees. That
 * makes it indefensible for EVERY dish and perfectly defensible for a handful,
 * which is a decision a person makes about a dish rather than a flag a
 * deployment sets. So this is the flag's opposite number: the manual path,
 * spending deliberately, on dishes named on the command line.
 *
 * It is the generating twin of `seed-step-art`, which uploads the one
 * hand-made Tuna Tataki set and draws nothing. Both write to the same bucket at
 * the same key, and the app shows whatever is there — the flag decides whether
 * art is DRAWN, never whether it is SHOWN.
 *
 * ## It draws the exported prompt, never a copy
 *
 * `buildStepArtPrompt` moved into `@fridgeezy/genai` for this, the move
 * `buildRecipeImagePrompt` already made for `render-recipe-art`. A script
 * holding its own paragraph drifts from the shipping one, and in the worst
 * direction: these pictures sit beside pictures the API drew, so a drifted
 * prompt shows up as two dishes in two styles in one app.
 *
 * ## The billing path is the reason it can be run at all
 *
 * With `GOOGLE_CLOUD_PROJECT` set, IMAGE generation talks to Vertex, which
 * bills as an ordinary Cloud service and so can be paid for with the $300 Cloud
 * credit that AI Studio's prepay balance explicitly cannot touch. Only images
 * move — speech stays on `GOOGLE_API_KEY`; see the client for why the two are
 * split rather than switched together. The run prints which path it is on
 * before it spends anything, because that is the one fact that decides who gets
 * the bill and it is invisible everywhere else.
 */
const BUCKET = "recipe_step_art";

/**
 * The gathering page's object name, which is not a number.
 *
 * `mise` rather than 0, matching the client's `recipeMiseImageUri`: it is not
 * an instruction, and numbering it into the method's own space is what makes an
 * off-by-one a picture on the wrong page.
 */
const MISE = "mise" as const;

/** A step number, or the gathering page. */
type Slot = number | typeof MISE;

/**
 * `gemini-3.1-flash-image`'s list price, and the only number this script uses
 * to talk about money. It is the same figure `create-step-art` quotes; a model
 * passed with `--model` will not match it, which the estimate says outright
 * rather than quietly reporting the wrong total.
 */
const USD_PER_IMAGE = 0.067;

/**
 * How long to wait before retrying a rate-limited render, per attempt, in ms.
 *
 * Vertex answers a project over its per-minute image quota with a bare 429 —
 * no `Retry-After`, no `RetryInfo` in the body — so the wait has to be guessed
 * and the first guess has to be generous. Measured on this project: a burst of
 * three concurrent renders trips it after about six pictures, and dropping to
 * one concurrent render does NOT clear it; what cleared it every time was
 * roughly seventy seconds of silence. So the ladder starts above a minute
 * rather than at the usual second or two — a sub-minute retry into a
 * per-minute bucket is a request spent to learn nothing.
 *
 * Four waits, ~6.5 minutes of patience in total. A 13-picture method is the
 * shape this has to survive unattended.
 *
 * **A free-trial project cannot raise this quota** — Google's own free-trial
 * terms exclude quota-increase requests — so waiting is not a workaround for
 * a form somebody could fill in instead. It is the mechanism.
 */
const BACKOFF_MS = [70_000, 90_000, 120_000, 150_000];

/**
 * Jitter, as a fraction of the wait.
 *
 * Two workers that trip the limit on the same second would otherwise retry on
 * the same second, hit it together, and keep their lockstep all the way up the
 * ladder — spending every attempt in pairs.
 */
const BACKOFF_JITTER = 0.2;

/**
 * Three at once, copied from `create-step-art` and for its reason: a twelve-step
 * recipe firing twelve concurrent image calls is a burst big enough to hit a
 * provider rate limit, and nothing is waiting on this.
 */
const DEFAULT_CONCURRENCY = 3;

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

const DISHES = list(arg("dishes")) ?? [];
const IDS = list(arg("ids")) ?? [];

/**
 * A subset of the pictures, for redrawing the one that came back wrong without
 * paying for the other eleven. Step numbers, and the literal `mise` for the
 * gathering page. Implies nothing about the rest: anything not named is left
 * exactly as it is, drawn or not.
 */
const STEPS: Slot[] = (list(arg("steps")) ?? [])
    .map((value) => (value === MISE ? MISE : Number(value)))
    .filter((value) => value === MISE || (value as number) > 0);

/**
 * Draw the steps and nothing else.
 *
 * For a method whose gathering page is already right, or for a recipe whose
 * ingredient list is too thin to be worth a picture. The default is to draw it:
 * a method with pictures on every step and none on the page in front of them
 * reads as one missing file rather than as a decision.
 */
const NO_MISE = process.argv.includes("--no-mise");

/**
 * Draw without attaching the dish's hero as a style reference.
 *
 * The reference is ON by default because the pictures it fixes are the ones
 * that were visibly wrong — a dressing the prose could not get onto the food.
 * This is here so a bad render can be re-rolled WITHOUT it and the two compared,
 * which is the only way to tell a reference that is helping from one that is
 * dragging every step toward the finished dish.
 */
const NO_REFERENCE = process.argv.includes("--no-reference");

/**
 * The chosen gathering page, shown to every new one as the standard.
 *
 * A committed fixture rather than an object in the `art_direction` bucket, and
 * that is deliberate on both counts. It must NOT join the hero set: that set is
 * an explicit list of six, and `style-anchors.ts` spends pages on what happens
 * when its members agree about something incidental — three bowls taught
 * "bowl", a plate shot from higher up taught a second camera. A picture of nine
 * little dishes would teach all of it at once to every recipe hero in the app.
 * And it lives in the repo because only this script reads it: the API's
 * `create-step-art` attaches no references at all. If that path ever wants one,
 * this becomes a bucket object and gains a slot list of its own.
 *
 * 768px WebP, the size `install-style-anchor` re-encodes to and for its reason:
 * an anchor is the one image here that is an INPUT, so its bytes are paid on
 * every render forever rather than once.
 */
const MISE_ANCHOR = join(process.cwd(), "operations", "data", "mise-anchor.webp");

const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Render to `operations/output/step-art/` and upload nothing — the
 * look-before-you-install half that `render-recipe-art` keeps for heroes. It
 * writes the encoded WebP rather than the model's own bytes, so what is judged
 * is what would have been stored.
 */
const OUT_ONLY = process.argv.includes("--out-only");

const MODEL = arg("model") as
    | Parameters<typeof generateImage>[0]["model"]
    | undefined;

const CONCURRENCY = Number(arg("concurrency") ?? DEFAULT_CONCURRENCY);

const OUT_DIR = join(process.cwd(), "operations", "output", "step-art");

const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

const storagePath = (recipeId: string, slot: Slot) =>
    `${recipeId}/${slot}.webp`;

interface Step {
    step_number: number;
    instruction_text: string;
}

interface Target {
    id: string;
    name: string;
    steps: Step[];
    /**
     * The recipe's ingredients, by name and in the order it lists them — the
     * gathering page's whole subject, and read for nothing else.
     */
    ingredients: string[];
    /** Slots that already have an object in the bucket. */
    drawn: Set<Slot>;
    /**
     * The dish's own hero, base64, or null — read ONCE per recipe and handed to
     * every render of it.
     *
     * Per recipe rather than per picture: it is the same few hundred KB for all
     * nine, and fetching it in `render` would pull it down once per step for no
     * reason. Null when the row has no image, when the fetch fails, or under
     * `--no-reference`; all three mean the prompt simply omits the clause.
     */
    reference: { data: string; mimeType: string } | null;
}

/**
 * The gathering anchor, read once for the whole run.
 *
 * Absent is a legitimate state — the file is optional, and a run without it
 * simply falls back to the hero alone, which is what every render before the
 * anchor existed had.
 */
const loadMiseAnchor = (): { data: string; mimeType: string } | null => {
    if (NO_REFERENCE) return null;

    try {
        return {
            data: readFileSync(MISE_ANCHOR).toString("base64"),
            mimeType: "image/webp",
        };
    } catch {
        console.warn("· no gathering anchor on disk — drawing from the hero alone");

        return null;
    }
};

const miseAnchor = loadMiseAnchor();

/**
 * The dish's hero as base64, or null.
 *
 * Never throws. A missing or unreachable hero is a picture drawn without an
 * anchor, which is exactly what every picture drawn before today was — so it
 * degrades to the previous behaviour rather than failing a run that is about to
 * spend money on the other eight.
 */
async function loadReference(
    image: string | null,
): Promise<Target["reference"]> {
    if (NO_REFERENCE || !image) return null;

    try {
        const response = await fetch(image);

        if (!response.ok) {
            console.warn(`· hero fetch ${response.status} — drawing unanchored`);

            return null;
        }

        return {
            data: Buffer.from(await response.arrayBuffer()).toString("base64"),
            // From the stored URL's extension rather than the response header:
            // the bucket serves these as image/webp and the models take webp,
            // but a stack fronting storage with a CDN can answer
            // application/octet-stream, which they do not.
            mimeType: image.endsWith(".png")
                ? "image/png"
                : image.endsWith(".jpg") || image.endsWith(".jpeg")
                  ? "image/jpeg"
                  : "image/webp",
        };
    } catch (error) {
        console.warn(`· hero fetch failed — drawing unanchored:`, error);

        return null;
    }
}

/**
 * Resolve a dish NAME to every SHARED method under it — one per rung.
 *
 * ## `is_personal`, not `base_recipe_id`, and that was a real bug
 *
 * This filtered on `base_recipe_id IS NULL` and carried a comment claiming "a
 * dish with several difficulty rungs is several original rows". That is false.
 * A rung written by `escalate` is filed as a VARIANT — it carries a
 * `base_recipe_id` — and it is still a SHARED row that any reader at that
 * level is served. Measured on this catalogue: six of them (Ramen, Teriyaki
 * Salmon, Vinaigrette, Matcha Ice Cream, Oxtail Soup, Tuna Tataki), every one
 * invisible to `--dishes=`. So somebody drew a dish's art, opened the app at
 * their own level, and found the recipe unillustrated.
 *
 * `recipes.is_personal` is the column that actually asks the question, and it
 * exists precisely because the client could not: it is trigger-maintained and
 * marks a row as SOMEBODY'S copy rather than part of the catalogue. False
 * covers the original and every shared rung; true is one reader's private
 * version, which nobody else will ever open and which must not be drawn on a
 * shared budget. It is non-null on every row, so the filter cannot silently
 * drop anything.
 *
 * ## Every rung is drawn, because every rung is a different method
 *
 * A hard Ramen is twelve steps against the easy one's seven, with different
 * instructions. Taking the first row as representative would put pictures of
 * one method over the sentences of another, which is the same failure the
 * personal-copy exclusion avoids from the other direction.
 */
async function resolveByName(dish: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
        .from("recipes")
        .select("id, difficulty")
        .eq("name", dish)
        .eq("is_personal", false);

    if (error) throw new Error(`Could not read recipes: ${error.message}`);

    if (!data?.length) {
        console.warn(`· no shared recipe named "${dish}" on this stack`);

        return [];
    }

    if (data.length > 1) {
        console.log(
            `· "${dish}" has ${data.length} shared methods (${data
                .map((row) => row.difficulty ?? "?")
                .join(", ")}) — drawing each`,
        );
    }

    return data.map((row) => row.id);
}

async function loadTarget(id: string): Promise<Target | null> {
    const { data: recipe } = await supabaseAdmin
        .from("recipes")
        .select("id, name, image")
        .eq("id", id)
        .maybeSingle();

    if (!recipe) {
        console.warn(`· no recipe ${id} on this stack`);

        return null;
    }

    const { data: steps, error } = await supabaseAdmin
        .from("recipe_instructions")
        .select("step_number, instruction_text")
        .eq("recipe_id", id)
        .order("step_number");

    if (error) throw new Error(`Could not read steps: ${error.message}`);

    if (!steps?.length) {
        console.warn(`· ${recipe.name} has no steps`);

        return null;
    }

    // By NAME and in the recipe's own order, which is the gathering page's
    // whole subject. Read here rather than lazily at render time so a run that
    // cannot see them fails in the plan rather than a third of the way through.
    const { data: ingredients } = await supabaseAdmin
        .from("recipe_ingredients")
        .select("ingredients(name)")
        .eq("recipe_id", id);

    // Listed once per recipe rather than probed per slot: one round trip
    // against up to thirteen, and the answer is the same.
    const { data: existing } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(id);

    const drawn = new Set<Slot>();

    for (const object of existing ?? []) {
        const name = object.name.replace(/\.webp$/, "");

        if (name === MISE) drawn.add(MISE);
        else if (Number.isFinite(Number(name))) drawn.add(Number(name));
    }

    return {
        id,
        name: recipe.name,
        steps,
        ingredients: (ingredients ?? [])
            .map((row) => row.ingredients?.name)
            .filter((name): name is string => !!name),
        drawn,
        reference: await loadReference(recipe.image),
    };
}

/**
 * What will be drawn for a target, and why the rest will not be.
 *
 * The two exclusions are counted apart rather than summed: "3 already drawn"
 * and "3 not in --steps" are different facts, and reporting the second as the
 * first tells the operator their pictures exist when nothing has been drawn.
 */
const planFor = (target: Target) => {
    // The gathering page leads, because it is the page in front of step one and
    // a run that is interrupted should leave a method illustrated from the
    // start rather than from the middle.
    const slots: Slot[] = [
        // A recipe whose ingredients could not be read gets no gathering page:
        // the subject IS the list, so an empty one would draw an empty table.
        ...(NO_MISE || target.ingredients.length === 0 ? [] : [MISE]),
        ...target.steps.map((step) => step.step_number),
    ];

    const selected = slots.filter(
        (slot) => STEPS.length === 0 || STEPS.includes(slot),
    );

    const todo = selected.filter((slot) => FORCE || !target.drawn.has(slot));

    return {
        todo,
        unselected: slots.length - selected.length,
        alreadyDrawn: selected.length - todo.length,
        /** Every slot this recipe COULD have, for the "n of m" line. */
        total: slots.length,
    };
};

const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a thrown error is the provider saying "too fast".
 *
 * Read off the STATUS rather than the message: the SDK surfaces an `ApiError`
 * carrying the HTTP code, and matching on the prose ("Resource has been
 * exhausted") would break the day Google rewords it. The message is checked
 * only as a fallback for an error that arrives without a status, which is what
 * a transport-level failure looks like.
 */
const isRateLimited = (error: unknown): boolean => {
    const status = (error as { status?: number })?.status;

    if (status === 429) return true;

    return (
        status === undefined &&
        /RESOURCE_EXHAUSTED|rate limit|quota/i.test(String(error))
    );
};

/**
 * Generate, retrying while the provider is rate-limiting us.
 *
 * Only a 429 is retried. Everything else — a refusal, a malformed prompt, a
 * model that returned text instead of an image — is a fault that waiting will
 * not fix, and retrying it four times over six minutes would turn one bad
 * prompt into a run that appears to hang.
 *
 * The wait is ANNOUNCED. A script that silently stops for two minutes reads as
 * a hang, and the operator's correct response to a hang is to kill it — which
 * here means killing a run that was going to succeed.
 */
async function generateWithRetry(
    label: string,
    options: Parameters<typeof generateImage>[0],
): Promise<Awaited<ReturnType<typeof generateImage>>> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await generateImage(options);
        } catch (error) {
            if (!isRateLimited(error) || attempt >= BACKOFF_MS.length) throw error;

            const base = BACKOFF_MS[attempt];
            const wait = Math.round(
                base * (1 + (Math.random() * 2 - 1) * BACKOFF_JITTER),
            );

            console.log(
                `· ${label}: rate limited, waiting ${Math.round(
                    wait / 1000,
                )}s (attempt ${attempt + 1} of ${BACKOFF_MS.length})`,
            );

            await sleep(wait);
        }
    }
}

async function render(target: Target, slot: Slot): Promise<boolean> {
    const label =
        slot === MISE
            ? `${target.name} gathering page`
            : `${target.name} step ${slot}`;

    // A slot is a number, so the instruction is looked up rather than carried:
    // the plan is a list of what to draw, and only the renderer needs the prose.
    const step = target.steps.find((candidate) => candidate.step_number === slot);

    if (slot !== MISE && !step) {
        console.error(`✗ ${label}: no such step in this method`);

        return false;
    }

    try {
        // ONE list, used to build the prompt AND the payload, so the clause's
        // "the FIRST" / "the SECOND" cannot come to mean a different picture
        // than the one actually attached.
        const miseRefs: MiseReference[] = [
            ...(slot === MISE && miseAnchor ? (["gathering"] as const) : []),
            ...(target.reference ? (["hero"] as const) : []),
        ];

        const images = [
            ...(slot === MISE && miseAnchor ? [miseAnchor] : []),
            ...(target.reference ? [target.reference] : []),
        ];

        const { base64Data } = await generateWithRetry(label, {
            prompt:
                slot === MISE
                    ? buildMiseArtPrompt(target.name, target.ingredients, {
                          references: miseRefs,
                      })
                    : buildStepArtPrompt(
                          target.name,
                          (step as Step).instruction_text,
                          { styleReference: !!target.reference },
                      ),
            ...(images.length > 0 && { referenceImages: images }),
            // 4:3, matching the band cook mode draws these in — see
            // `COOK_ART_BLEED_HEIGHT`, which is picked against that ratio.
            aspectRatio: "4:3",
            ...(MODEL && { model: MODEL }),
        });

        if (!base64Data) {
            console.error(`✗ ${label}: model returned no image`);

            return false;
        }

        // The hero's encoder, for its WebP settings. The card variant and the
        // thumbhash it also produces are discarded: a step band has one size
        // and no placeholder of its own.
        const { hero } = await encodeRecipeImageVariants(
            Buffer.from(base64Data, "base64"),
        );

        if (OUT_ONLY) {
            const dir = join(OUT_DIR, slugify(target.name));

            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${slot}.webp`), hero);

            console.log(`✓ ${label} → ${join(dir, `${slot}.webp`)}`);

            return true;
        }

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(storagePath(target.id, slot), hero, {
                contentType: "image/webp",
                upsert: true,
                // Seconds, NOT a header — supabase-js prefixes `max-age=`.
                cacheControl: "31536000",
            });

        if (error) {
            console.error(`✗ ${label}: ${error.message}`);

            return false;
        }

        console.log(`✓ ${label} — ${(hero.length / 1024).toFixed(0)}K webp`);

        return true;
    } catch (error) {
        console.error(`✗ ${label}:`, error);

        return false;
    }
}

async function main() {
    if (DISHES.length === 0 && IDS.length === 0) {
        console.error(
            "Nothing targeted. Pass --dishes=\"A,B\" or --ids=<uuid>,<uuid>.",
        );
        process.exitCode = 1;

        return;
    }

    console.log("=== Recipe step art ===\n");
    console.log(
        `Billing:     ${
            isVertexConfigured()
                ? `Vertex AI (project ${process.env.GOOGLE_CLOUD_PROJECT}, ${
                      process.env.GOOGLE_CLOUD_LOCATION ?? "global"
                  })`
                : "Gemini API / AI Studio key"
        }`,
    );
    console.log(`Stack:       ${process.env.SUPABASE_URL}`);
    console.log(`Model:       ${MODEL ?? "default (gemini-3.1-flash-image)"}`);
    console.log(
        `Anchor:      ${
            NO_REFERENCE
                ? "none (--no-reference)"
                : `each dish's own hero${miseAnchor ? " + the gathering anchor" : ""}`
        }`,
    );
    console.log(
        `Destination: ${OUT_ONLY ? OUT_DIR : `storage bucket ${BUCKET}`}\n`,
    );

    const ids = [
        ...IDS,
        ...(await Promise.all(DISHES.map(resolveByName))).flat(),
    ];

    const targets = (await Promise.all([...new Set(ids)].map(loadTarget)))
        .filter((target): target is Target => target !== null);

    if (targets.length === 0) {
        console.log("\nNothing to draw.");

        return;
    }

    // Every resolved target is reported, including one with nothing left to
    // draw: "already done" and "no such dish" are different answers and the
    // run is worth nothing if it cannot tell them apart.
    const plan = targets.map((target) => ({
        target,
        ...planFor(target),
    }));

    const total = plan.reduce((sum, entry) => sum + entry.todo.length, 0);

    for (const entry of plan) {
        const notes = [
            entry.alreadyDrawn ? `${entry.alreadyDrawn} already drawn` : null,
            entry.unselected ? `${entry.unselected} not in --steps` : null,
        ].filter(Boolean);

        // "pictures" rather than "steps": the count includes the gathering
        // page, which is not one, and a line reading "9 of 9 steps" for an
        // eight-step method is the report contradicting the recipe.
        console.log(
            `${entry.target.name} (${entry.target.id}) — ${
                entry.todo.length
            } of ${entry.total} pictures${
                notes.length ? ` (${notes.join(", ")})` : ""
            }`,
        );
    }

    if (total === 0) {
        console.log(
            "\nNothing to draw — a picture that already exists is skipped. " +
                "Pass --force to redraw one.",
        );

        return;
    }

    console.log(
        `\n${total} image${total === 1 ? "" : "s"} ≈ $${(
            total * USD_PER_IMAGE
        ).toFixed(2)}${MODEL ? " (at the default model's price, not this one's)" : ""}`,
    );

    if (DRY_RUN) {
        console.log("\n--dry-run: nothing drawn, nothing spent.");

        return;
    }

    // A fixed pool rather than chunked `Promise.all`: chunking makes every
    // worker wait for the slowest render in its chunk, and these vary by
    // seconds. Flattened across targets so a two-step dish does not hold the
    // pool at one-third occupancy while the next dish waits.
    const queue = plan.flatMap(({ target, todo }) =>
        todo.map((slot) => ({ target, slot })),
    );

    let drawn = 0;

    console.log("");

    await Promise.all(
        Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
            for (let job = queue.shift(); job; job = queue.shift()) {
                if (await render(job.target, job.slot)) drawn++;
            }
        }),
    );

    console.log(`\n${drawn}/${total} drawn`);

    // A slot whose render failed simply has no picture, and cook mode draws
    // nothing for a page with no picture — which is what every page looks like
    // today.
    //
    // Re-running is still the outer retry, and it stays cheap for the reason it
    // always did: an already-drawn picture is skipped, so a second run costs
    // only what failed. What changed is that reaching here after a 429 now
    // means the backoff ladder was exhausted too — several minutes of waiting —
    // so the honest advice is to come back later rather than to run it again
    // immediately into the same empty bucket.
    if (drawn < total) {
        console.log(
            "Re-run to retry what failed; drawn pictures are skipped. " +
                "If these were rate limits, give the project a few minutes first.",
        );
    }

    // The app finds these by LISTING the bucket (`useRecipeStepArt`), so
    // nothing has to be named anywhere for them to appear — that replaced a
    // hard-coded allowlist of dish names this script used to have to remind the
    // operator about. What is worth saying instead is the cache: the manifest
    // sits on the hourly REFERENCE tier and is persisted, so a device that
    // already looked at this dish keeps answering from its copy until that
    // lapses.
    if (drawn > 0 && !OUT_ONLY) {
        console.log(
            "\nCook mode picks these up by listing the bucket — no client " +
                "change needed. A device that already opened one of these " +
                "dishes may keep its cached manifest for up to an hour.",
        );
    }
}

main();
