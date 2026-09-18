import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * PoC — cooking-action illustrations that DEPICT, for the chat's technique
 * answer ("What does 'grate' mean here?").
 *
 * This deliberately reverses `poc-step-action-art.ts`. That one tested whether
 * an action could be drawn INSIDE the house direction, which bans hands, tools
 * and named ingredients by name — so every render collapsed into the result on
 * a plate, and the verbs whose meaning is a GESTURE (sear, fold, deglaze) came
 * back saying nothing. `action-sear.jpg` there reads as a slice of toast.
 *
 * The namelessness rule is dropped on the owner's call. The reasoning is that
 * these two pictures answer different questions: cook mode's band sat above a
 * SPECIFIC dish, so a nameable ingredient would have been a lie about what the
 * reader was cooking. A chat answer to "what does grate mean" is a DEFINITION,
 * and a definition of grating is cheese against a grater. Generic was the
 * requirement there and is the failure here.
 *
 * ## What is overridden, and what is NOT
 *
 * One sentence of the shared background rule — the banned-noun list — is
 * swapped for `DEPICTIVE_GROUND` below. Everything else the direction pins
 * (camera, palette, light, tone, the watercolour medium, the no-text trailer)
 * is untouched, so these still have to look like they came from the same
 * kitchen as every recipe hero.
 *
 * **No hands.** The two examples that prompted this — a grater with cheese
 * falling into a bowl, a knife dicing an onion — describe a tool and food and
 * no arm, and that is the cheaper concession: a hand is the one noun that
 * pulls this style toward stock photography, and the tool carries the verb
 * without it. `poc-step-action-art.ts`'s `fold-hand` variant already priced the
 * other option and it is there to compare against.
 *
 * ## The five
 *
 * `grate` and `dice` are the owner's own examples. The other three are the
 * verbs the nameless PoC FAILED on, chosen on purpose: if depiction is worth
 * breaking the direction for, it has to rescue those, not just improve the cut
 * verbs that already worked.
 */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE moment, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, sequence, set of steps, mood board, or a frame divided into panels or quadrants by any line, gutter or border.`;

/**
 * The verb has to be the subject, not a caption on a still life.
 *
 * Every one of these prompts names a moment MID-ACTION rather than a finished
 * result, because the finished result is what the nameless PoC already draws
 * and it is what failed: a seared steak on a plate and a raw steak on a plate
 * differ by a brown edge, while a steak going into a hot pan is unmistakable.
 */
const MID_ACTION = `- The picture is caught MID-ACTION, not after it. Something is visibly in motion or in contact — falling, cutting through, being lifted, hitting the heat — and the moment could not be mistaken for a finished dish standing still.`;

/**
 * The trace variant of `MID_ACTION`, for a verb that has no moment to catch.
 *
 * `MID_ACTION` demands something visibly in motion, which is a contradiction
 * for `reduce` (twenty minutes of nothing happening) and for a hands-free
 * `knead`. These read the verb from what it LEFT BEHIND instead — a tide line,
 * a fold, a drag through flour — so the clause asks for the evidence to be
 * unmistakably the record of an action rather than a still life.
 */
const MID_ACTION_OR_TRACE = `- The picture is not a still life. It is the moment just AFTER the action, and it carries unmistakable physical evidence of what was done — a mark, a fold, a line, a trace left behind — so that a cook can tell at a glance what happened here and that it happened recently.`;

/**
 * Replaces the shared rule's banned-noun sentence.
 *
 * It keeps every negative that is about STAGING (marble, cloth, napkins, props,
 * garnish scattered for effect) and drops only the ones that are about the
 * action itself. The tool count is capped at one on purpose — two tools in
 * frame is a kitchen scene, and a kitchen scene is the thing the original rule
 * is protecting the style from.
 */
const DEPICTIVE_GROUND = `Exactly ONE tool may appear — the one this action is performed with — plus, where the action needs it, ONE plain pale board or ONE plain ceramic vessel. The tool is drawn in the same sparse warm-grey linework as everything else and is never the brightest or hardest object in the picture. No hands, arms, sleeves or people anywhere. No marble, wood grain, cloth, napkins, tiles, worktops, hobs, packaging, jars, labels or props of any kind, and no second tool.`;

/**
 * The two wordings to swap out — one per `vessel` branch.
 *
 * They are NOT the same sentence, which the first run of this script found the
 * hard way: the `ceramic` branch bans "stray garnish outside the vessel" and
 * capitalises, the `none` branch does neither. A single literal silently
 * matched three of five renders.
 */
const BANNED_NOUNS = [
    "No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel.",
    "no table surface, marble, wood grain, cloth, cutlery, napkins or hands, ever.",
];

/** The shared style block with the one sentence swapped. Asserts the swap. */
/**
 * The technique set's ground — the light theme's `surface`, not the house
 * cream. See `technique-art-prompt.ts` in the API, which carries the argument;
 * this script has to match it or the bundled six and the on-demand renders come
 * back on two different grounds.
 */
const GROUND = { name: "soft white", hex: "#FFFFFF" };

const depictiveStyle = (
    options: Parameters<typeof buildFoodIllustrationStyle>[0]
) => {
    const style = buildFoodIllustrationStyle({ ground: GROUND, ...options });
    const banned = BANNED_NOUNS.find((sentence) => style.includes(sentence));

    if (!banned) {
        // Loud rather than silent: if the shared rule is reworded upstream, a
        // failed replace leaves the render banning the tool the whole PoC is
        // about, and the only symptom is a picture of food standing still.
        throw new Error(
            `No banned-noun sentence found for vessel "${options.vessel ?? "ceramic"}" — re-read art-direction/index.ts and update BANNED_NOUNS.`
        );
    }

    return style.replace(banned, DEPICTIVE_GROUND);
};

interface Action {
    /** Why this one is in the set. */
    note: string;
    prompt: string;
}

const ACTIONS: Record<string, Action> = {
    /**
     * The owner's worked example, and the easy end: a cut verb, where the tool
     * and the falling shreds both say the word on their own.
     */
    grate: {
        note: "Owner's example. Cut verb — the shreds carry it.",
        prompt: `Editorial illustration of a wedge of hard cheese being grated into a bowl.

SUBJECT
- ONE upright four-sided box grater standing over ONE shallow ceramic bowl, seen slightly from the side.
- A wedge of pale golden hard cheese is pressed against the grater's face, part way down a stroke.
- A loose fall of fine cheese shreds drops from the grater's lower edge into the bowl, and a small soft heap of the same shreds has already gathered in the bowl below.
- The grater is plain, matte and unbranded, drawn in sparse warm-grey linework.
${MID_ACTION}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    framing:
        "the grater and bowl together are centred and fill about two thirds of the frame's width, with the fall of shreds running down through the middle of the picture. A generous even margin of empty ground on all four sides, and nothing cropped by an edge.",
    renderingEmphasis:
        "The falling shreds are the sharpest, most legible detail in the picture — separate, light, unmistakably fine strands rather than a blur or a cloud.",
    mood: "mid-stroke — the moment the cheese becomes shreds.",
})}`,
    },

    /**
     * The owner's second example, and the one that needs a BOARD — the noun the
     * shared rule bans hardest. Drawn as a pale plain board rather than wood,
     * so the concession costs the style a shape and not a material.
     */
    dice: {
        note: "Owner's example. Needs the board — the banned noun, granted as a pale plain one.",
        prompt: `Editorial illustration of an onion being diced on a board.

SUBJECT
- ONE half onion, cut side down on ONE plain pale board, with ONE chef's knife cutting down through it part way along.
- The onion is already scored into a fine grid on the part behind the blade; ahead of the blade it is still whole.
- A small neat heap of even little onion dice sits beside it on the board, clearly the same onion further along.
- The knife is plain, matte and unbranded, its blade drawn in sparse warm-grey linework, angled down through the cut rather than resting flat.
${MID_ACTION}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    vessel: "none",
    framing:
        "the board fills most of the frame's width and the onion sits a little left of centre with the dice heaped to its right, so the picture reads left to right from whole to diced. Nothing is cropped by an edge except, at most, the far end of the board.",
    renderingEmphasis:
        "The evenness and small size of the finished dice is the clearest thing in the picture, and the scored grid on the uncut half is legible as the same cut in progress.",
    mood: "mid-cut — whole on one side of the blade, diced on the other.",
})}`,
    },

    /**
     * The hardest verb in the app for this style, and the reason the set is
     * five rather than two. It needs a PAN, heat and liquid — three nouns the
     * direction has no vocabulary for. If depiction cannot carry this one, the
     * honest answer is that the picture set stops at the cut verbs.
     */
    deglaze: {
        note: "Hardest case. Failed as a plate in the nameless PoC; needs pan, liquid and heat.",
        prompt: `Editorial illustration of liquid being poured into a hot pan to lift the browned bits from its base.

SUBJECT
- ONE shallow pan seen from a low three-quarter angle, its base darkened with sticky browned residue.
- A thin stream of pale wine is falling into the pan from just above the frame's upper edge, striking the base and throwing up a soft bloom of steam.
- Where the liquid has landed, the browned residue is visibly lifting and swirling loose into it, in curling warm-brown ribbons; where it has not yet reached, the base is still dry and dark.
- The pan is plain, matte and unbranded. No hob, flame, ring, handle grip, bottle or second vessel.
${MID_ACTION}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    vessel: "none",
    framing:
        "the pan is centred and fills about three quarters of the frame's width, seen low enough that its base is clearly visible. The pouring stream enters from the top of the frame and may be cropped by that edge; the pan itself is never cropped.",
    renderingEmphasis:
        "The contrast between the still-dry dark base and the part already lifting into the liquid is the strongest shape in the picture. The steam is a pale soft wash, never a hard white plume.",
    mood: "the hiss — stuck becoming sauce.",
})}`,
    },

    /**
     * The gesture verb. The nameless PoC's own variant A drew this as two
     * marbled masses in a bowl and it read as a dessert; the whole question
     * here is whether one spatula turns the same picture into an instruction.
     */
    fold: {
        note: "Gesture verb. The nameless version read as marbled pudding; the tool is the test.",
        prompt: `Editorial illustration of whipped egg white being folded into a batter with a spatula.

SUBJECT
- ONE shallow ceramic bowl holding a pale yellow batter with a lighter, airier white mass part way folded through it.
- ONE plain silicone spatula is mid-stroke: its blade has cut down through the middle of the mixture and is sweeping up and over, lifting a broad ribbon of the batter across the top of the white.
- The two mixtures are deliberately unfinished — streaked and marbled where they meet, still clearly two things, with the curve of the spatula's stroke visible through them.
- The spatula is plain, matte and unbranded. No hand, arm or second tool.
${MID_ACTION}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    framing:
        "the bowl is centred and fills about two thirds of the frame's width, tilted enough to show the mixture inside it. The spatula stays entirely inside the frame and is never cropped by an edge.",
    renderingEmphasis:
        "The lifted ribbon of batter turning over the white is the strongest shape in the picture — an unmistakable single curving stroke, not a stirred swirl.",
    mood: "mid-stroke — over, not through.",
})}`,
    },

    /**
     * The direct rematch. `action-sear.jpg` in the nameless PoC is a pale block
     * with one brown face on a plate, and it reads as toast; this is the same
     * verb with the pan and the heat it actually needs.
     */
    sear: {
        note: "Direct rematch against action-sear.jpg, which read as toast.",
        prompt: `Editorial illustration of a steak searing in a hot pan.

SUBJECT
- ONE shallow pan seen from a low three-quarter angle with ONE thick steak lying in it.
- The steak's underside is a deep browned crust where it meets the hot base; its upper side is still raw and pale red. A pair of plain tongs grips its far edge, part way through lifting it to show that crust.
- A soft bloom of steam rises from where the meat meets the pan, and a thin sheen of fat catches the light around it.
- The pan is plain, matte and unbranded. No hob, flame, ring, hand or second tool beyond the tongs.
${MID_ACTION}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    vessel: "none",
    framing:
        "the pan is centred and fills about three quarters of the frame's width, seen low enough that the lifted edge of the steak and the crust beneath it are both clearly visible. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The dark crust on the underside against the still-raw upper side is the whole picture and must be unmistakable at a glance.",
    mood: "the contact — cold meat meeting hot metal.",
})}`,
    },

    /**
     * Round two, and a different mechanism from the first five.
     *
     * Those all read the verb from something caught IN MOTION — falling shreds,
     * a blade part way through, liquid striking a pan. That only works for a
     * verb that has a moment. `reduce` does not: it is twenty minutes of
     * nothing visibly happening, and the definition is a DIFFERENCE between two
     * levels rather than an event.
     *
     * So the action is drawn as the mark it leaves — the dried tide line high
     * on the pan wall against the shallow pool left below it. If this reads,
     * the set can cover the long verbs (braise, proof, rest) that no
     * mid-action picture could ever reach.
     */
    reduce: {
        note: "Tests a verb with no moment — read from a level difference, not an event.",
        prompt: `Editorial illustration of a sauce that has boiled down to a fraction of its original volume.

SUBJECT
- ONE wide shallow pan seen from a low three-quarter angle, so that a good height of its inner wall is visible.
- In the base sits a shallow pool of glossy dark-amber sauce, plainly a small fraction of what the pan once held.
- High up the inner wall is a clear dried tide line where the liquid first stood, with one fainter ring between it and the present surface. The empty band of stained wall between the top line and the sauce is the most important thing in the picture.
- A few slow, thick, lazy bubbles sit at the sauce's surface and a thin thread of steam rises from it.
- The pan is plain, matte and unbranded. No hob, flame, spoon, hand or second vessel.
${MID_ACTION_OR_TRACE}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    vessel: "none",
    framing:
        "the pan is centred and fills about three quarters of the frame's width, seen low enough that the tide line on the far inner wall and the sauce below it are both clearly visible in the same view. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The tide line and the stained empty band beneath it are drawn with more definition than anything else in the picture, so the drop in level is the first thing seen.",
    mood: "long after the start — what is left of what there was.",
})}`,
    },

    /**
     * The one that prices the no-hands rule, and it is chosen precisely because
     * `cooking_actions` defines it as "Work dough with hands". A picture with no
     * hands in it would be contradicting its own caption on the same card.
     *
     * Drawn as the TRACE instead — the fold, the pressed groove, the drag mark
     * through the flour. If that reads, the rule holds everywhere and hands are
     * never needed. If it does not, this is the exact render that says the price
     * out loud, and the answer is to allow a hand for the handful of verbs that
     * are a pair of hands.
     */
    knead: {
        note: "Prices the no-hands rule against the one verb the table defines as needing them.",
        prompt: `Editorial illustration of a mass of bread dough on a board, showing the marks of having just been pushed and folded.

SUBJECT
- ONE rounded mass of pale dough on ONE plain pale board.
- Its near edge has been stretched forward and folded back over itself, and a long smooth pressed groove runs down the middle of the fold where it was pushed away.
- The stretched, worked side of the dough is smooth, taut and faintly glossy; the far side is still rough and shaggy, so the two states sit in one piece.
- A light dusting of flour lies on the board, with a clear smeared drag mark through it leading away from the dough, exactly where it has just been pushed.
- No hands, arms or people. No tool of any kind.
${MID_ACTION_OR_TRACE}
${SINGLE_IMAGE_RULE}

${depictiveStyle({
    vessel: "none",
    framing:
        "the board fills most of the frame's width with the dough a little left of centre, so the drag mark through the flour runs away to the right with room to be seen. Nothing is cropped by an edge except, at most, the far end of the board.",
    renderingEmphasis:
        "The fold and the pressed groove across it are the strongest shapes in the picture, and the smeared drag mark in the flour is clearly a trace of movement rather than scattered dust.",
    mood: "the moment after the push — the dough still holding the shape of it.",
})}`,
    },
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "action-art-depictive");

const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(ACTIONS).filter(
        ([name]) => !only || name === only
    );

    console.log("=== Depictive cooking-action art PoC ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} actions\n`);

    let failed = 0;

    for (const [name, action] of entries) {
        try {
            console.log(`Generating ${name} — ${action.note}`);

            const { base64Data, mimeType } = await generateImage({
                prompt: action.prompt,
                model: MODEL,
                // 4:3 — these are drawn in a wide card under a chat bubble, and
                // a square loses a third of its height to that crop.
                aspectRatio: "4:3",
            });

            if (!base64Data) {
                throw new Error(
                    `Model returned no image data for ${name} — the prompt likely produced a text response.`
                );
            }

            const file = `${name}.${extensionFor(mimeType)}`;
            writeFileSync(join(OUT_DIR, file), Buffer.from(base64Data, "base64"));
            console.log(`✓ ${file}`);
        } catch (error) {
            failed++;
            console.error(
                `✗ ${name}: ${error instanceof Error ? error.message : error}`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\nWritten to ${OUT_DIR}`);
    if (failed) console.log(`${failed} failed`);
}

main();
