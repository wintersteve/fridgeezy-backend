// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

const BUCKET = "dish_tiles";

/**
 * One dish per course, and no `main`.
 *
 * These are the `course` tags minus `main` — see `COURSE_ORDER` in
 * `compose-menu-screen`, which is exactly these three plus the main. The card
 * these fill never shows a main: on the home feed it is the part you bring, and
 * on a recipe screen it is the dish you are already reading, which the client
 * drops into the middle slot itself.
 *
 * Curated the same way `CUISINES` in `generate-category-images` names one
 * representative dish per cuisine: the model needs a concrete dish to plate, and
 * "an appetizer" is not something anyone can illustrate.
 */
const COURSE_DISHES = {
    appetizer: "burrata with heirloom tomatoes and basil",
    side: "rosemary roast potatoes",
    dessert: "dark chocolate tart with raspberries",
};

/**
 * The plating half, shared by both dish sets so only the vessel varies.
 *
 * Trimmed from `create-recipe-image`'s: these are ~110pt tiles, so the
 * unit-versus-mass rule and the counted-garnish rule buy nothing at this size
 * and only cost prompt length. The portion guard stays — without it Michelin
 * plating language shrinks a salad to two leaves and a smear.
 */
const plating = (dish: string) => `PLATING
- A complete, appetising restaurant portion of ${dish} — generous enough to read as a real serving. Refine and elevate the presentation; never deconstruct it into a sparse arrangement of isolated pieces.
- Compose rather than pile: a clear centrepiece with components placed with intent.
- Add one controlled sauce element and one considered finishing garnish, both belonging to this dish. Savoury dishes take micro-herbs, seeds, zest or a thin drizzle; sweet dishes take fruit, chocolate, caramel, cream or nuts — never savoury herbs on a sweet dish.
- Build height, layering and textural contrast — crisp against soft, glossy against matte.
- Unmistakably ${dish}: every ingredient it is known for stays present and identifiable, in its own natural colour.`;

/**
 * The two dish sets, and why each is shaped the way it is.
 *
 * ## Framing instructions do not work; object descriptions do
 *
 * Measured 2026-08-05 over fifteen renders, five framings, three dishes each.
 * Three of the five asked the *camera* to move — push in past the rim, crop the
 * bowl to an arc, fill the frame — and all three came back centred with a large
 * margin, exactly like a recipe hero. The two that worked changed what the
 * *object* is. A tall thing fills a tall frame whether or not the camera
 * cooperates.
 *
 * This is the same wall `padPngToSquare` documents: subject size swung 51–87% of
 * frame height across identical prompts and no wording closed it. **If a tile
 * comes back too small, change the vessel, not the framing.**
 *
 * - `platter` fills its column because the vessel is long and stood on end. It
 *   backs the home feed's full-bleed layout, where empty ground would show.
 * - `bowl` deliberately keeps the empty upper half that made it fail as a
 *   full-bleed tile. The client crops it to a shorter box anchored to the
 *   bottom, so that emptiness becomes the margin around a floated plate.
 */
const DISH_SETS = {
    platter: (dish: string) => `Editorial food illustration of ${dish}.

${plating(dish)}

VESSEL SHAPE
- Served on a long, narrow RECTANGULAR ceramic platter with squared corners, oriented vertically so its long axis runs from the top of the frame to the bottom. Never a round or oval plate.
- The food is arranged along the length of the platter rather than mounded in the middle.

${buildFoodIllustrationStyle({
    framing:
        "the rectangular platter runs the full height of the frame and is cut off by the top and bottom edges, filling most of the frame's width. Only a slim margin of background shows at the left and right.",
    renderingEmphasis:
        "Detail is spread evenly along the length of the platter so the whole column reads.",
    mood: "linear and composed — a tasting course laid along its dish.",
})}`,

    bowl: (dish: string) => `Editorial food illustration of ${dish}.

${plating(dish)}

VESSEL SHAPE
- Served in a deep ceramic bowl, seen close enough that only a broad arc of its near rim crosses the lower part of the frame.

${buildFoodIllustrationStyle({
    framing:
        "the bowl sits low in the frame, its near rim sweeping across the lower third and running off both side edges, with quiet empty background filling everything above it.",
    renderingEmphasis:
        "Detail is heaviest in the food, which sits in the lower half of the frame.",
    mood: "immersive and warm — looking down into a full bowl.",
})}`,
};

/**
 * The middle slot when no dish has been chosen: colour where a dish would be,
 * and nothing nameable.
 *
 * It is generated rather than drawn in the client so it shares the bowls'
 * granulation, bleeding edges and palette — a placeholder that is obviously the
 * same hand as the two plates beside it, rather than a diagram sitting between
 * two paintings. `vessel: "none"` because the washes imply a plate without one
 * being drawn; asking for a real vessel here produced an empty bowl, which is a
 * different (and more literal) idea.
 *
 * The negative clause is doing the work. Left looser, the model resolves the
 * blooms into an actual dish — the whole point is that it must not.
 */
const PLACEHOLDER_PROMPT = `Abstract editorial illustration: soft washes of colour suggesting a dish, with no dish depicted.

SUBJECT
- Overlapping translucent watercolour blooms and a few loose brushed strokes, pooling toward the lower half of the frame as though a plated dish were about to resolve out of them.
- NOTHING is recognisable. No ingredient, no vessel, no plate, no food of any kind, no object with a name. Only colour, edge and texture.
- Soft bleeding edges where washes meet; a few fine warm grey lines drifting through, suggesting contour without describing anything.

${buildFoodIllustrationStyle({
    vessel: "none",
    framing:
        "the washes gather in the lower two thirds of the frame and fade out toward the top, touching the left and right edges and softening before they reach them.",
    renderingEmphasis:
        "Pure gouache and watercolour behaviour — granulation, bleeding, dry-brush — and no drawn subject at all.",
    mood: "unresolved and quiet — the moment before a dish exists.",
})}`;

/**
 * Which courses each set needs.
 *
 * `platter` backs the home feed's three-across ground, so it needs all three.
 * `bowl` only ever renders the two *outer* plates — the middle one is the main,
 * and that is either the recipe being read or `bowl-placeholder`, never a side.
 * Generating `bowl-side` would be paying for an image nothing displays.
 */
const SET_COURSES = {
    platter: ["appetizer", "side", "dessert"],
    bowl: ["appetizer", "dessert"],
} as const;

/** Every asset this operation owns, as `<storage path>` → prompt. */
const TILES: Record<string, string> = {
    ...Object.fromEntries(
        Object.entries(SET_COURSES).flatMap(([set, courses]) =>
            courses.map((course) => [
                `${set}-${course}.png`,
                DISH_SETS[set as keyof typeof DISH_SETS](
                    COURSE_DISHES[course as keyof typeof COURSE_DISHES]
                ),
            ])
        )
    ),
    "bowl-placeholder.png": PLACEHOLDER_PROMPT,
};

/**
 * Skip anything already in the bucket unless `--force`.
 *
 * These are *curated* generations, not derived data: the ones in storage were
 * chosen from a set of candidates, and re-rolling them gives different pictures
 * for the same prompt. Overwriting by default would mean a routine re-run
 * silently replaced the art someone picked. `generateAndUploadRecipeImage`
 * short-circuits on an existing object for the same reason.
 */
const force = process.argv.includes("--force");

async function generateAndUpload(
    path: string,
    prompt: string
): Promise<"skipped" | "ok" | "failed"> {
    try {
        if (!force) {
            const { data: existing } = await supabaseAdmin.storage
                .from(BUCKET)
                .list("", { search: path });

            if (existing?.some((file) => file.name === path)) {
                console.log(`· ${path} — already present, skipping`);
                return "skipped";
            }
        }

        console.log(`Generating ${path}...`);

        const { base64Data, mimeType } = await generateImage({
            prompt,
            numberOfImages: 1,
            // Generated at the aspect they are displayed at, so there is no
            // padding step here — `padPngToSquare` exists to shrink a subject
            // relative to its frame, which is the opposite of what these want.
            aspectRatio: "9:16",
        });

        // The model sometimes answers a prompt with text and no image at all;
        // passing that to Buffer.from() raises an opaque TypeError instead of
        // saying what went wrong.
        if (!base64Data) {
            throw new Error(
                `Model returned no image data for ${path} — the prompt likely produced a text response.`
            );
        }

        const { error } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, Buffer.from(base64Data, "base64"), {
                contentType: mimeType,
                upsert: true,
            });

        if (error) throw new Error(error.message);

        console.log(`✓ ${path}`);
        return "ok";
    } catch (error) {
        console.error(
            `✗ ${path}: ${error instanceof Error ? error.message : error}`
        );
        return "failed";
    }
}

async function main() {
    const entries = Object.entries(TILES);

    console.log("=== Compose-card Tile Generation ===\n");
    console.log(`Bucket: ${BUCKET}`);
    console.log(`${entries.length} assets at 9:16, unpadded.`);
    console.log(
        force
            ? "--force: existing assets WILL be regenerated and overwritten.\n"
            : "Existing assets are skipped. Pass --force to re-roll them.\n"
    );

    const results = [];

    for (const [path, prompt] of entries) {
        results.push(await generateAndUpload(path, prompt));
        // Same spacing as `generate-category-images` — enough to stay clear of
        // the image API's rate limit on a back-to-back run.
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const count = (value: string) =>
        results.filter((result) => result === value).length;

    console.log("\n=== Summary ===\n");
    console.log(
        `✓ generated ${count("ok")}  ·  skipped ${count("skipped")}  ·  failed ${count("failed")}`
    );

    if (count("failed") > 0) process.exitCode = 1;
}

main();
