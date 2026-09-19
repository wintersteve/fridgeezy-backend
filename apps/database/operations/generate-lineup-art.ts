// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * The first-run lineup: five ingredients with drawn faces, pleased to be there.
 *
 * `IngredientLineup` on the app's setup page stands these five in a row and
 * throws one off when the reader's own answers exclude it. They are the crash
 * set's cast in the opposite mood — same face rule, same containment, same
 * disc composition — and they are a SECOND set rather than a re-render of the
 * first, because the crash screen still needs its sad ones.
 *
 * ## Why this is its own operation and not a scene in `generate-client-art`
 *
 * The same reason `generate-crash-art` is: every other illustration goes
 * through `buildFoodIllustrationStyle` unedited, and its trailer ends "not
 * cartoonish". A face is outside that, so these two operations are the only
 * surfaces whose prompt reaches into the shared style and takes a clause out.
 *
 * It is a SIBLING of that file rather than a mood flag on it, and that is
 * deliberate: a `mood: "happy" | "sad"` option is a door, and the next surface
 * that fancies a mascot would find it open. The cost is that `FACE_RULE` and
 * `allowDrawnFace` exist twice — which is the trade the crash operation's own
 * header already argues for, and the duplication is eleven lines that fail
 * loudly rather than a shared option that fails quietly.
 *
 * ## The CAST is chosen by what it can be excluded BY
 *
 * Not by what paints well. Each of the five stands for one of the restrictions
 * a reader is most likely to hold, and the set is arranged so the common
 * answers cascade rather than all landing at once:
 *
 * - **sausage** — meat. Goes for vegan, vegetarian AND pescatarian.
 * - **prawn** — shellfish. Goes for vegan and vegetarian, and STAYS for a
 *   pescatarian, which is the one pair in the set where two adjacent diets
 *   disagree.
 * - **cheese** — dairy. Goes for vegan and for paleo, stays for vegetarian.
 * - **egg** — eggs. Goes for vegan, stays for vegetarian.
 * - **loaf** — gluten. Goes for gluten free, keto and paleo, and is the only
 *   one a vegan keeps.
 *
 * So vegetarian takes two, vegan takes those two and the egg and the cheese.
 *
 * ## And four UNDERSTUDIES, who nothing excludes
 *
 * A vegan would otherwise be left looking at one loaf, so the row has a bench of
 * SIX: a mushroom, a tomato, a head of broccoli, an aubergine, a block of tofu
 * and an almond.
 *
 * The first four are chosen to be excluded by NOTHING — not one of the nineteen
 * dietary options rules them out — so an understudy can always take the stage.
 * The last two are the DEEP bench, for a reader carrying several restrictions at
 * once: vegan and gluten free between them take all five of the cast, which four
 * understudies cannot cover.
 *
 * **Those two also earn their place by making two more answers mean something.**
 * `nut free` and `soy free` moved nobody at all until the almond and the tofu
 * existed, which left two of the seven "free from" bands drawing nothing. Six of
 * the seven are covered now — the loaf, the cheese, the egg, the prawn, the
 * almond and the tofu — and only sesame is not, there being no way to paint a
 * seed as one subject with a face.
 *
 * They are also what puts COLOUR in the row. The five above are cream, pink-tan,
 * gold, yellow and coral — a warm monochrome — so after a vegan swap the row
 * reads mushroom, tomato, loaf, broccoli, aubergine: brown, red, gold, green,
 * purple. The picture gets better the more the reader tells us.
 *
 * See `lineup-cast.ts` in the app, which is the table this set exists to serve —
 * **change one and change both**.
 *
 * ## What is being compared
 *
 * One variable. The face, the framing, the camera and the mood are identical
 * across all five; only the ingredient and its own way of looking WELL change.
 * Each subject has to succeed in its SHAPE — plump, upright, curled, fanned,
 * risen — because that is what survives the pale chalky register, and it is the
 * exact inverse of the crash set's droop, split, slump and wilt.
 *
 * Composed for a disc, like every medallion — subject centred, about two thirds
 * of the frame, corners expendable. Three-quarter rather than the overhead the
 * other medallions use, because a face seen from directly above is not a face.
 */

/** Said to every scene — see `generate-client-art`, where it is not boilerplate. */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE subject, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, quadtych, mood board, set of variations, or a frame divided into panels or quadrants by any line, gutter or border.`;

/**
 * The narrow permission that replaces "not cartoonish".
 *
 * Every clause is load-bearing and they are the crash set's, with two words
 * changed: the brows sit level instead of tilting up at their inner ends, and
 * the mouth turns up instead of down. Everything else has to stay identical or
 * the two sets stop being the same cast — without the linework clause the model
 * paints glossy cartoon eyes from a different app, without "never a character"
 * it grows arms and legs, and without "no pupils, no highlights" it drifts
 * toward a plush toy.
 *
 * **A happy face is the one that most wants to become a mascot**, so the limits
 * matter more here than they did on the sad set: no rosy cheeks, no wink, no
 * open smile. Five marks, in the grey already on the page.
 */
const FACE_RULE = `- It has a face, and the face is made ONLY of the same sparse, fine, warm grey linework as the rest of the drawing: two small round eyes, two short brows sitting level and relaxed, and one simple upturned mouth. Nothing else.
- The face is drawn flat onto the subject, small and quiet, sitting in the middle of its body. No pupils, no eyelashes, no highlights, no glossy shine, no blush, no cheeks, no tongue, no teeth, no winking, no open laughing mouth, and absolutely no arms, legs, hands, feet or limbs of any kind.
- It is an ingredient with a face drawn on it — never a character, a mascot, a creature, a toy or a cartoon animal, and it is never standing up or doing anything.`;

/**
 * Takes the "not cartoonish" clause out of the shared trailer.
 *
 * Throws rather than degrading: a silent miss would emit the unmodified style,
 * the model would obey it, and five renders would come back faceless with
 * nothing saying why.
 */
const CARTOON_CLAUSE = " not cartoonish,";

const allowDrawnFace = (style: string) => {
    if (!style.includes(CARTOON_CLAUSE)) {
        throw new Error(
            `The shared trailer no longer contains "${CARTOON_CLAUSE.trim()}". ` +
                `generate-lineup-art removes that clause on purpose and cannot ` +
                `silently stop doing so — re-read buildFoodIllustrationStyle's ` +
                `trailer and update CARTOON_CLAUSE.`
        );
    }

    return style.replace(CARTOON_CLAUSE, "");
};

const STYLE = allowDrawnFace(
    buildFoodIllustrationStyle({
        vessel: "none",
        // Three-quarter, not the medallions' overhead: a face seen from
        // directly above is a face you cannot see.
        camera: "three-quarter",
        framing:
            "the ingredient is centred in a square frame and fills about two thirds of its width and height, leaving a generous, completely even margin of empty ground on all four sides. Nothing touches or is cropped by an edge, and nothing at all sits in the corners of the frame.",
        renderingEmphasis:
            "The drawn face is the smallest and quietest thing in the picture — a few fine grey marks, never inked heavier or darker than the linework around it.",
        mood: "cheerful and completely at ease — pleased to be here, and not showing off about it.",
    })
);

/** One subject per member. The face is constant; the way it looks WELL is not. */
const SUBJECTS: Record<string, string> = {
    /** Stands for MEAT. The plumpest silhouette of the five. */
    sausage: `Editorial illustration of one plump fresh sausage, with a happy face drawn on it.

SUBJECT
- ONE single raw pork sausage link, and nothing else in the picture. It is lying down rather than standing.
- It is full and rounded along its whole length, curving in one easy gentle arc, with a neat twist at each end.
- Its skin is smooth, matte and evenly filled — taut rather than wrinkled, and plump rather than shrivelled.
- Nothing is cooked, charred, split, greasy or shiny.`,

    /**
     * Stands for SHELLFISH, and for the one pair of diets that disagree — a
     * vegetarian loses it and a pescatarian keeps it.
     */
    prawn: `Editorial illustration of one fresh prawn, with a happy face drawn on it.

SUBJECT
- ONE whole peeled prawn, and nothing else in the picture. It is lying on its side.
- It is curled into its natural comma shape, firm and springy rather than limp, with its tail fanned open at the narrow end.
- Fine soft segment lines run across its body. Its colour is a warm coral pink, deepening a little toward the tail.
- It is raw and whole: nothing is cooked, battered, skewered, chopped or served on anything.`,

    /** Stands for DAIRY. The one hard geometric shape in the set. */
    cheese: `Editorial illustration of one wedge of cheese, with a happy face drawn on it.

SUBJECT
- ONE single wedge of firm pale-yellow cheese, and nothing else in the picture. It is resting on its flat base.
- It is a clean triangular wedge cut from a round, with a soft natural rind along its curved outer edge and crisp flat cut faces.
- It sits square and upright, holding its shape: nothing is sagging, melting, sweating or crumbling.
- No holes, no grater, no board, no plate, no knife, no crumbs.`,

    /** Stands for EGGS, and it is the whole of the vegan/vegetarian difference. */
    egg: `Editorial illustration of one fresh whole egg, with a happy face drawn on it.

SUBJECT
- ONE whole pale egg, and nothing else in the picture. It is resting on its side, tilted very slightly so it does not read as a perfect oval.
- Its shell is completely smooth and unbroken, with the faintest speckling.
- The egg sits plump and settled, at rest rather than about to roll.
- Nothing is cracked, chipped, broken open, spilled or in a cup, carton or nest.`,

    /** Stands for GLUTEN, and it is the one a vegan keeps — so it has to carry a shot on its own. */
    loaf: `Editorial illustration of one small round loaf of bread, with a happy face drawn on it.

SUBJECT
- ONE small round country loaf, and nothing else in the picture. It is resting on its base.
- It has risen into a generous dome, with one clean scored cross cut across its top that has opened as it baked.
- Its crust is an even warm golden brown with a light dusting of flour, matte rather than glossy.
- It is whole: nothing is sliced, cut, torn, buttered, on a board or beside a knife.`,

    /** UNDERSTUDY. First off the bench, and the one everybody reads as meat's stand-in. */
    mushroom: `Editorial illustration of one whole mushroom, with a happy face drawn on it.

SUBJECT
- ONE whole chestnut mushroom, and nothing else in the picture. It is standing on its stalk.
- Its cap is a full rounded dome, firm and smooth, in a soft warm brown that pales toward the rim.
- Its stalk is short and thick and sits squarely under the cap, a pale cream.
- It is whole and fresh: nothing is sliced, cut, shrivelled, spotted, dirty or picked over.`,

    /** UNDERSTUDY. The red in the row, and the crash set's own strongest subject — well, this time. */
    tomato: `Editorial illustration of one ripe tomato, with a happy face drawn on it.

SUBJECT
- ONE ripe round tomato, and nothing else in the picture. It is resting on its base.
- It is full and perfectly round, its skin smooth, taut and evenly deep red.
- Its small green calyx sits up neatly on top, its points lifted rather than curled down.
- It is whole and unblemished: nothing is split, bruised, wrinkled, spotted or cut.`,

    /** UNDERSTUDY. The only green in the row, and the one shape nobody can mistake. */
    broccoli: `Editorial illustration of one head of broccoli, with a happy face drawn on it.

SUBJECT
- ONE small head of broccoli, and nothing else in the picture. It is standing on its stalk.
- Its crown is a dense, springy dome of fine green florets with a soft bumpy edge, sitting on one short thick pale-green stalk.
- The green is fresh and even, deepening a little toward the top of the crown.
- It is whole: nothing is cut into florets, chopped, cooked, yellowing or wilting.`,

    /**
     * DEEP BENCH, and the reason `soy free` finally moves somebody. The vegan
     * protein, so it is the right thing to find where a sausage or a prawn was.
     */
    tofu: `Editorial illustration of one block of firm tofu, with a happy face drawn on it.

SUBJECT
- ONE single block of firm white tofu, and nothing else in the picture. It is resting squarely on its base.
- It is a clean rectangular block with softly rounded edges and corners, standing up straight and holding its shape.
- Its surface is matte and very slightly textured, an even cool cream-white with the faintest warm shadow down one side.
- It is raw and whole: nothing is cubed, sliced, pressed, fried, crumbled, marinated, on a plate or in water.`,

    /**
     * DEEP BENCH, and the reason `nut free` finally moves somebody. An almond
     * rather than a peanut: a peanut is a legume, and the tag says nut.
     */
    almond: `Editorial illustration of one whole almond, with a happy face drawn on it.

SUBJECT
- ONE whole shelled almond, and nothing else in the picture. It is standing upright on its broad rounded end, with its pointed tip at the top.
- It is a full plump teardrop, smooth and matte, in a warm pale tan with the faintest fine grain running down its length.
- It is whole and fresh: nothing is cracked, split, halved, flaked, chopped, roasted dark or in a shell.`,

    /** UNDERSTUDY. The deepest colour of the nine, and the best silhouette. */
    aubergine: `Editorial illustration of one whole aubergine, with a happy face drawn on it.

SUBJECT
- ONE whole deep-purple aubergine, and nothing else in the picture. It is lying down rather than standing.
- Its body is full and firm, holding one smooth even curve from its shoulder to its rounded end — plump rather than slender, and not bent or sagging anywhere.
- Its green calyx and short stalk sit up neatly at the top.
- The skin is smooth and matte: no glossy shine, no highlights, and nothing wrinkled, spotted or dented.`,
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "lineup-art");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(SUBJECTS).filter(
        ([name]) => !only || name === only
    );

    console.log("=== First-run lineup ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} subjects\n`);

    let failed = 0;

    for (const [name, subject] of entries) {
        try {
            console.log(`Generating ${name}...`);

            const { base64Data, mimeType } = await generateImage({
                prompt: `${subject}
${FACE_RULE}
${SINGLE_IMAGE_RULE}

${STYLE}`,
                model: MODEL,
                aspectRatio: "1:1",
            });

            if (!base64Data) {
                throw new Error(
                    `Model returned no image data for ${name} — the prompt likely produced a text response.`
                );
            }

            const file = `${name}.${extensionFor(mimeType)}`;
            writeFileSync(
                join(OUT_DIR, file),
                Buffer.from(base64Data, "base64")
            );
            console.log(`✓ ${file}`);
        } catch (error) {
            failed++;
            console.error(
                `✗ ${name}: ${error instanceof Error ? error.message : error}`
            );
        }
        // Same spacing as the other image operations.
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\nWritten to ${OUT_DIR}`);
    // Downscaled to 640px on the way in — see `ArtMedallion`, which documents
    // why the raw 1024 render is not what gets committed.
    console.log(
        "\nInstall all five over the placeholders the app ships with:\n" +
            "  for n in sausage prawn cheese egg loaf mushroom tomato broccoli aubergine tofu almond; do\n" +
            "    sips -Z 640 --setProperty format jpeg --setProperty formatOptions 70 \\\n" +
            "      operations/output/lineup-art/$n.jpg \\\n" +
            "      --out ../../../Projects/fridgeezy/src/assets/images/illustrations/lineup-$n.jpg\n" +
            "  done\n" +
            "\nThe client seam is `ArtMedallion`'s ART map and `IngredientLineup`.\n" +
            "The exclusions those five have to match live in the app's `lineup-cast.ts`."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
