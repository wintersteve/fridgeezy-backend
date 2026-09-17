// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * PoC ONLY — one cooking ACTION, drawn three ways, to settle whether a
 * per-step action illustration can exist inside the house art direction.
 *
 * The action is `fold`. The step it is tested against is a real catalogue row:
 * Korean Savoury Cabbage Pancake step 5, "Combine vegetables and batter".
 *
 * The problem this is measuring: an action picture normally needs a HAND, a
 * TOOL and a PAN, and the shared art direction forbids all three by name
 * ("No table surface, marble, wood grain, cloth, cutlery, napkins, hands").
 * So there are exactly three ways out, and they are the three renders here.
 */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE subject, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, quadtych, mood board, set of variations, or a frame divided into panels or quadrants by any line, gutter or border.`;

/**
 * The clause that makes an action picture REUSABLE, and it is lifted from the
 * `generate` scene rather than invented: "suggesting food without ever becoming
 * an identifiable ingredient. Nothing on the plate has a name."
 *
 * That scene solved the same problem from the other end — it had to paint a
 * dish that does not exist yet. Here it is what stops a picture of folding
 * being a picture of folding CABBAGE INTO BATTER, which would tie one image to
 * one recipe and defeat the whole point.
 */
const NAMELESS = `- Nothing in the picture is an identifiable ingredient. The two masses are soft blooms and folds of colour — one pale warm cream, one soft sage — that read as food without ever becoming a nameable vegetable, grain, meat or fruit. Nobody can say what dish this is.`;

interface Variant {
    prompt: string;
    note: string;
    /** Composed for the shape it is DISPLAYED in — see generate-client-art. */
    aspectRatio: Parameters<typeof generateImage>[0]["aspectRatio"];
}

/**
 * The mise en place half of the namelessness rule.
 *
 * Looser than `NAMELESS` above, and it has to be: that one forbids anything
 * nameable outright, which is right for two abstract masses in one bowl and
 * would turn six bowls of prep into six bowls of mush. Here the CUT is allowed
 * to be legible while the food is not — which is exactly what makes one picture
 * serve every recipe in the catalogue.
 */
const NAMELESS_MISE = `- Nothing in the bowls is an identifiable ingredient. Each holds a recognisable CUT or TEXTURE in a soft, muted hue — cream, pale sage, soft peach, gentle ochre — but nobody can say which vegetable, herb, grain, meat or fruit any of them is, and nobody can say what dish is being made.`;


/**
 * The namelessness rule for an ACTION picture.
 *
 * Same job as `NAMELESS_MISE` and the same reason: one picture per verb has to
 * serve every recipe that verb appears in, so the moment the food is a nameable
 * ingredient the image belongs to one dish. What is allowed to be legible is the
 * CUT, the CRUST, the COATING — the thing the verb did — because that is the
 * verb, and it is true of whatever the cook happens to be holding.
 */
const NAMELESS_ACTION = `- Nothing in the picture is an identifiable ingredient. The food is a soft, pale, unnameable mass in cream, gentle ochre or pale sage — nobody can say which vegetable, fish, meat, grain or fruit it is, and nobody can say what dish is being made. What IS clearly legible is what has just been done to it.`;

const VARIANTS: Record<string, Variant> = {
    /**
     * A — inside the direction. The action is read in the FOOD's state: two
     * masses caught half-combined, with the stroke of the fold still in them.
     * No hand, no tool, no pan. Nothing in the style block is broken.
     */
    "fold-state": {
        aspectRatio: "1:1",
        note: "Inside the art direction. Action read from the food's state only.",
        prompt: `Editorial illustration of one ceramic bowl holding two soft masses caught in the middle of being folded together.

SUBJECT
- ONE shallow ceramic bowl, and nothing else in the picture. It is the whole subject.
- It holds two distinct masses of colour that are PART WAY through becoming one: a pale cream mass and a soft sage mass, with one lifted and turned over through the other in a single broad curving stroke.
- The moment is deliberately unfinished — the two colours are neither separate nor fully blended. A soft marbled spiral where they meet is the whole picture, and it clearly records a gesture that has just happened.
- No spoon, spatula, whisk, hand, arm, pan or tool of any kind anywhere in the image.
${NAMELESS}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. It is never cropped by an edge, and nothing at all sits in the corners of the frame.",
    renderingEmphasis:
        "The curving boundary where the two colours turn through each other is the strongest shape in the picture and stays legible at a glance.",
    mood: "mid-gesture — two things on their way to being one.",
})}`,
    },

    /**
     * B — the tool, no hand. The middle path: a spatula is cutlery, which the
     * background rule bans, so this breaks the direction by exactly one noun.
     */
    "fold-tool": {
        aspectRatio: "1:1",
        note: "Breaks the direction by ONE noun: a tool in frame, still no hand.",
        prompt: `Editorial illustration of one ceramic bowl with a spatula resting in it, mid-fold.

SUBJECT
- ONE shallow ceramic bowl holding two soft masses of colour part way through being folded together — one pale cream, one soft sage, turning through each other in a broad curving stroke.
- ONE simple wooden-handled spatula rests in the bowl at the end of that stroke, lifting a little of the pale mass over the sage. It is plain, matte and unbranded.
- NO hand, arm, sleeve, person or body part anywhere in the image. The spatula rests on its own.
- No pan, hob, table, cloth or second object.
${NAMELESS}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl is centred in a square frame and fills about two thirds of its width, leaving a generous, completely even margin of empty ground on all four sides. The spatula stays entirely inside the frame and is never cropped by an edge.",
    renderingEmphasis:
        "The spatula is drawn with the same sparse warm-grey linework as everything else and never becomes the brightest or hardest object in the picture.",
    mood: "mid-gesture — the stroke just made.",
})}`,
    },

    /**
     * C — the honest version of what the request asks for: a hand doing the
     * action. Breaks the direction outright, and is generated precisely so the
     * cost is looked at rather than argued about.
     */
    "fold-hand": {
        aspectRatio: "1:1",
        note: "Breaks the direction outright: hand + tool. Generated to price it.",
        prompt: `Editorial illustration of a hand folding one mass of food through another with a spatula.

SUBJECT
- ONE shallow ceramic bowl holding two soft masses of colour — one pale cream, one soft sage — part way through being folded together.
- ONE hand holds a plain wooden-handled spatula and is turning the pale mass over through the sage in a broad curving stroke. The hand enters from the upper right and is cropped at the wrist; no face, no body, no second hand.
- The gesture is the subject: the lift and turn of the fold is unmistakable.
${NAMELESS}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl is centred in a square frame and fills about two thirds of its width. The hand and spatula enter from the upper right and may be cropped by that edge; the bowl itself is never cropped.",
    renderingEmphasis:
        "The hand is drawn in the same sparse warm-grey linework and pale washes as the food, never modelled, shaded or rendered as skin.",
    mood: "mid-gesture — someone's hands in the bowl.",
})}`,
    },

    /**
     * Mise en place — cook mode's first page, before step one.
     *
     * The subject is the one thing that makes this reusable: it reads through
     * CUTS, not through ingredients. A bowl of small dice, a bowl of fine
     * shreds, a bowl of thin rounds — that says "prepped and ready" whatever
     * the recipe is, where a bowl of diced onion says onion. Same trick as the
     * fold renders, where the TOOL carries the verb rather than the food.
     *
     * `4:3` because the app draws it in a 3:2 band and the model offers no 3:2:
     * a 4:3 painting in a 3:2 window loses about 11% of its height, so the
     * framing line asks for the bowls to run wide with the slack top and bottom.
     * 16:9 was the other candidate and is worse — it would crop the sides, which
     * is where the outermost bowls are.
     */
    "mise-overhead": {
        aspectRatio: "4:3",
        note: "Overhead — the measured answer for several vessels at once.",
        prompt: `Editorial illustration of several small ceramic bowls of prepared ingredients, seen from directly above, gathered and ready to cook with.

SUBJECT
- FIVE or SIX small ceramic bowls of different sizes, gathered in a loose, natural cluster that runs wide across the frame. They sit close together and a few overlap slightly at their rims; they are never lined up in a row or arranged into a grid.
- Each bowl holds a different PREPARATION rather than a different food: one of small even dice, one of fine shreds, one of thin rounds, one of a finely chopped green, one of a soft pale powder, one of a still liquid. The CUT is what is recognisable.
- It reads as everything measured out and standing by, before any cooking has happened. Nothing is cooked, plated, garnished or served.
- No table, no board, no cloth, no cutlery, no hands, no pan, no jars, no labels.
${NAMELESS_MISE}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the cluster of bowls is centred and runs wide across the frame, filling about four fifths of its width and about two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "Each bowl's contents read as a distinct texture at a glance — dice, shreds, rounds, mince, powder, liquid — and that difference between them is the whole picture.",
    mood: "everything in its place — the counter before the cooking starts.",
})}`,
    },

    /** The same subject at the step art's own camera, so the two agree. */
    "mise-angled": {
        aspectRatio: "4:3",
        note: "Three-quarter — matches the fold render's camera.",
        prompt: `Editorial illustration of several small ceramic bowls of prepared ingredients, gathered and ready to cook with.

SUBJECT
- FIVE or SIX small ceramic bowls of different sizes, gathered in a loose shallow arc that runs wide across the frame. They sit close together at slightly different distances, never lined up in a straight row.
- Each bowl holds a different PREPARATION rather than a different food: one of small even dice, one of fine shreds, one of thin rounds, one of a finely chopped green, one of a soft pale powder, one of a still liquid. The CUT is what is recognisable.
- It reads as everything measured out and standing by, before any cooking has happened. Nothing is cooked, plated, garnished or served.
- No table, no board, no cloth, no cutlery, no hands, no pan, no jars, no labels.
${NAMELESS_MISE}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the arc of bowls is centred and runs wide across the frame, filling about four fifths of its width and about two thirds of its height, with the slack left as empty ground above and below rather than at the sides. The bowls nearer the camera never hide the ones behind them, and nothing is cropped by an edge.",
    renderingEmphasis:
        "Each bowl's contents read as a distinct texture at a glance — dice, shreds, rounds, mince, powder, liquid — and that difference between them is the whole picture.",
    mood: "everything in its place — the counter before the cooking starts.",
})}`,
    },

    /**
     * Tuna Tataki's set, and the first real test of one-image-per-verb.
     *
     * Every one is `4:3`, unlike the `fold` prototype's square: the app draws
     * these full-bleed across a band about 1.40 wide to high, so 4:3 (1.333)
     * loses almost nothing where a square loses a third of its height. The
     * framing line asks for the subject to run wide and leave its slack above
     * and below, so what the crop takes is empty ground.
     *
     * `sear` is the one that tests the art direction hardest. Searing wants a
     * PAN, and the background rule bans one by name — `vessel: "ceramic"` is a
     * serving vessel. It is drawn as the crust plus the tongs instead: the same
     * concession the fold render settled on, where the TOOL carries the verb, so
     * the whole set costs the direction one noun rather than two.
     */
    "action-mix": {
        aspectRatio: "4:3",
        note: "Step 1 — combining a dressing. The whisk carries the verb.",
        prompt: `Editorial illustration of a small ceramic bowl of liquids being stirred together, with a whisk resting in it.

SUBJECT
- ONE shallow ceramic bowl holding a pool of pale amber liquid, with two or three lighter and darker liquids turning slowly through it in soft ribbons that have not yet become one colour.
- ONE small plain whisk rests in the bowl at the end of that turn, its wires half in the liquid. No hand, arm, sleeve or person anywhere.
- It reads as something being mixed, caught a moment before it is done.
- No pan, hob, table, cloth, jars, bottles or second vessel.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl and whisk are centred and run wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The ribbons turning through the liquid are the strongest shape in the picture and stay legible at a glance.",
    mood: "mid-stir — a dressing coming together.",
})}`,
    },

    "action-julienne": {
        aspectRatio: "4:3",
        note: "Step 2 — the cut IS the verb; a knife binds it to the act.",
        prompt: `Editorial illustration of a heap of fine matchstick-cut strips on a ceramic plate, with a knife alongside.

SUBJECT
- ONE shallow ceramic plate holding a loose heap of very fine, even matchstick strips, all cut to the same length and thickness, crossing each other where they fall.
- A few strips lie separately on the plate beside the heap, so the individual cut is clearly readable.
- ONE plain knife rests along the near edge of the plate. No hand, arm, sleeve or person anywhere.
- No board, table, cloth or second vessel.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the plate and knife are centred and run wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The evenness and fineness of the individual strips is the whole picture and stays crisp at a glance.",
    mood: "precise — everything cut to one size.",
})}`,
    },

    "action-slice": {
        aspectRatio: "4:3",
        note: "Steps 3 and 6 — one image, two steps. The reuse argument in one recipe.",
        prompt: `Editorial illustration of even slices fanned across a ceramic plate, with a knife alongside.

SUBJECT
- ONE shallow ceramic plate holding a neat fan of six or seven even slices, each the same thickness, overlapping in a single row so every slice's cut face is visible.
- ONE plain long knife rests along the near edge of the plate. No hand, arm, sleeve or person anywhere.
- No board, table, cloth or second vessel.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the plate and knife are centred and run wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The clean parallel edges of the fanned slices are the strongest shape in the picture.",
    mood: "clean — one steady cut after another.",
})}`,
    },

    "action-coat": {
        aspectRatio: "4:3",
        note: "Step 4 — the coated surface reads on its own; no tool needed.",
        prompt: `Editorial illustration of a pale block whose whole surface is covered in fine seeds, resting on a ceramic plate.

SUBJECT
- ONE shallow ceramic plate holding a single rounded pale block, every face of it covered in a dense even layer of small fine seeds that clearly sits ON the surface rather than being part of it.
- A loose scatter of the same seeds lies on the plate around the block, as if it has just been rolled through them.
- No hand, arm, sleeve, tool or person anywhere. No board, table, cloth or second vessel.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the plate is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The individual seeds on the surface and the loose scatter around it stay separately legible — the contrast between the covered block and the bare plate is the picture.",
    mood: "evenly covered — nothing left bare.",
})}`,
    },

    "action-sear": {
        aspectRatio: "4:3",
        note: "Step 5 — a sear wants a pan, which the direction bans. Crust + tongs instead.",
        prompt: `Editorial illustration of a pale block with one deeply browned face, resting on a ceramic dish with tongs alongside.

SUBJECT
- ONE shallow ceramic dish holding a single pale block turned so that TWO faces show: one deeply and evenly browned with a dark toasted crust, the other still pale and raw-looking. The contrast between the two faces is the whole subject.
- ONE pair of plain simple tongs rests along the near edge of the dish. No hand, arm, sleeve or person anywhere.
- No pan, skillet, hob, flame, smoke, board, table or cloth.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the dish and tongs are centred and run wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The hard line where the browned crust meets the pale face is the strongest edge in the picture and stays crisp.",
    mood: "just off the heat — brown outside, barely touched within.",
})}`,
    },

    "action-garnish": {
        aspectRatio: "4:3",
        note: "Step 7 — the scatter and the pinch bowl say finishing, not finished.",
        prompt: `Editorial illustration of a plated arrangement being finished with a scatter of small green flecks, with a tiny pinch bowl of them alongside.

SUBJECT
- ONE shallow ceramic plate holding a simple, settled pale arrangement, with a light scatter of small green and pale ochre flecks falling across one side of it — plainly just added rather than cooked in.
- ONE very small ceramic pinch bowl sits beside the plate holding more of the same flecks, so it reads as a finishing touch in progress.
- No hand, arm, sleeve, tool or person anywhere. No table, board or cloth.
${NAMELESS_ACTION}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the plate and the small pinch bowl are centred and run wide across the frame together, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The scattered flecks stay individually legible against the pale arrangement beneath them.",
    mood: "the last thing before it goes out.",
})}`,
    },

    /**
     * The SAME seven steps, drawn as the dish they actually are.
     *
     * The control group for the generic set above. Everything else is held
     * constant — same art direction, same camera, same 4:3, same model — and
     * only one thing changes: the food is Tuna Tataki's own rather than a
     * nameless mass.
     *
     * Two things to watch for when these come back. The pan problem largely
     * dissolves: "seared tuna loin" is a nameable object where "browned pale
     * block" was not, so step 5 needs no pan to read. And step 7 is the plated
     * dish, which is very close to what the recipe's HERO illustration already
     * shows — per-recipe step art pays twice for the last step of almost every
     * recipe.
     */

    "tataki-1": {
        aspectRatio: "4:3",
        note: "Step 1 — the ponzu dressing, chilled.",
        prompt: `Editorial illustration of a small ceramic bowl of dark citrus-soy dipping dressing, freshly mixed.

SUBJECT
- ONE small shallow ceramic bowl holding a pool of glossy dark amber-brown ponzu dressing.
- Fine flecks of grated ginger, grated garlic and bright green-yellow lime zest are suspended through it, with a faint swirl still turning where it was stirred.
- ONE small plain spoon rests across the rim. No hand, arm or person anywhere.
- No table, cloth, bottles or second vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The suspended flecks of zest and ginger stay individually legible in the dark liquid.",
    mood: "sharp and cold — the dressing, made and waiting.",
})}`,
    },

    "tataki-2": {
        aspectRatio: "4:3",
        note: "Step 2 — daikon matchsticks crisping in ice water.",
        prompt: `Editorial illustration of fine white daikon matchsticks crisping in a bowl of iced water.

SUBJECT
- ONE shallow ceramic bowl of clear cold water holding a tangle of very fine, even, bright white daikon radish matchsticks, all cut to the same size.
- A few small pieces of ice float among them and the strands lift and curl in the water.
- No hand, arm, tool or person anywhere. No table, cloth or second vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The whiteness and evenness of the individual matchsticks against the clear water is the whole picture.",
    mood: "cold and crisp — daikon waking up in ice.",
})}`,
    },

    "tataki-3": {
        aspectRatio: "4:3",
        note: "Step 3 — sliced scallion curling in iced water.",
        prompt: `Editorial illustration of finely sliced green scallion curling in a small bowl of iced water.

SUBJECT
- ONE small shallow ceramic bowl of clear cold water holding a scatter of very finely sliced green scallion rings, which have curled into tight loose spirals in the cold.
- A few ice fragments sit among them. The green is fresh and bright against the water.
- No hand, arm, tool or person anywhere. No table, cloth or second vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The curl of the individual scallion rings is the strongest shape in the picture.",
    mood: "fresh and green — scallion curling in the cold.",
})}`,
    },

    "tataki-4": {
        aspectRatio: "4:3",
        note: "Step 4 — the raw loin rolled in sesame.",
        prompt: `Editorial illustration of a raw tuna loin coated all over in toasted sesame seeds, on a ceramic plate.

SUBJECT
- ONE shallow ceramic plate holding a single rectangular block of deep ruby-red raw tuna loin, every face of it pressed into a dense even layer of pale toasted sesame seeds so the red shows only faintly beneath.
- A loose scatter of the same sesame seeds lies on the plate around it.
- No hand, arm, tool or person anywhere. No table, cloth or second vessel. The tuna is completely raw — no browning anywhere.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The individual sesame seeds on the surface stay separately legible, with the deep red of the tuna just showing between them.",
    mood: "pressed and ready — the loin, before the pan.",
})}`,
    },

    "tataki-5": {
        aspectRatio: "4:3",
        note: "Step 5 — seared outside, raw within. No pan needed.",
        prompt: `Editorial illustration of a seared sesame-crusted tuna loin resting on a ceramic dish, tongs alongside.

SUBJECT
- ONE shallow ceramic dish holding a single rectangular block of tuna loin whose outer surface is now seared to a thin toasted golden-brown sesame crust on every face.
- The block is turned so one cut END is visible: a narrow band of cooked pale grey-pink at the edge and a wide deep ruby-red raw centre. The contrast between the thin cooked rim and the raw middle is the whole subject.
- ONE pair of plain simple tongs rests along the near edge of the dish. No hand, arm or person anywhere.
- No pan, skillet, hob, flame or smoke.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The thin cooked band around a wide raw ruby centre is the sharpest edge in the picture and stays crisp.",
    mood: "just off the heat — barely cooked at all.",
})}`,
    },

    "tataki-6": {
        aspectRatio: "4:3",
        note: "Step 6 — the slices, ruby centre and sesame rim.",
        prompt: `Editorial illustration of slices of seared sesame-crusted tuna fanned across a ceramic plate, with a knife alongside.

SUBJECT
- ONE shallow ceramic plate holding a neat fan of seven or eight even slices of seared tuna, each about a centimetre thick and overlapping in a single row.
- Every slice shows the same face: a deep ruby-red raw centre ringed by a thin band of pale cooked flesh and an outer rim of pale toasted sesame seeds.
- ONE plain long thin knife rests along the near edge of the plate. No hand, arm or person anywhere.
- No board, table, cloth or second vessel.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The ruby centre, the thin pale cooked ring and the sesame rim read as three distinct bands on every slice.",
    mood: "clean — one steady cut after another.",
})}`,
    },

    "tataki-7": {
        aspectRatio: "4:3",
        note: "Step 7 — the plated dish. Note how close this is to a recipe hero.",
        prompt: `Editorial illustration of a finished plate of tuna tataki.

SUBJECT
- ONE shallow ceramic plate holding a fan of seared sesame-crusted tuna slices, each with a deep ruby centre and a pale sesame rim.
- Alongside them: a small nest of fine white daikon matchsticks, a scatter of curled green scallion rings, and a single green shiso leaf cut into fine strips.
- Dark ponzu dressing is drizzled over and pooled around the tuna, with a final scatter of toasted sesame and a few threads of ginger over the top.
- No hand, arm, cutlery, table or cloth.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the subject is centred and runs wide across the frame, filling about four fifths of its width and two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The fan of tuna is the centre of the picture and the garnishes gather to one side of it rather than being spread evenly.",
    mood: "composed and cold — the dish as it goes out.",
})}`,
    },

    /**
     * Tuna Tataki's own gathering page.
     *
     * Overhead, like the shared `mise-overhead` and for its measured reason —
     * `generate-cuisine-cards` found over 24 renders that a three-quarter
     * arrangement of several vessels loses its back row. What differs is that
     * these are the recipe's THIRTEEN actual ingredients rather than nameless
     * cuts, so the cook is looking at their own counter.
     *
     * Not all thirteen get a bowl: the four liquids that become one dressing
     * are drawn as one small dish of dark ponzu, because the page they sit on
     * groups by what the method asks for and a row of four identical brown
     * puddles reads as a mistake.
     */
    "tataki-mise": {
        aspectRatio: "4:3",
        note: "Mise en place, this dish — the real ingredients, laid out.",
        prompt: `Editorial illustration of everything needed for tuna tataki, prepared and laid out ready to cook, seen from directly above.

SUBJECT
- A loose cluster of small ceramic bowls and one small plate, gathered so they run wide across the frame. They sit close together and a few overlap slightly at their rims; never lined up in a row or a grid.
- ONE small plate holds a single rectangular block of deep ruby-red raw tuna loin.
- The bowls hold, each in its own: a heap of pale toasted sesame seeds; a tangle of fine white julienned daikon; a scatter of finely sliced green scallion rings; a small mound of pale grated ginger and grated garlic together; a few fresh green shiso leaves; one whole lime beside a small dish of its juice; and one small shallow dish of dark amber-brown ponzu dressing.
- Everything is already prepared — cut, grated, measured — and nothing is cooked. It reads as a counter set up before any cooking has started.
- No table surface, no board, no cloth, no cutlery, no hands, no pan, no bottles, no labels, no text.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the cluster is centred and runs wide across the frame, filling about four fifths of its width and about two thirds of its height, with the slack left as empty ground above and below rather than at the sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "The deep red of the tuna is the one strong colour and everything else stays pale and quiet around it; each bowl's contents read as a distinct texture at a glance.",
    mood: "everything in its place — the counter before the cooking starts.",
})}`,
    },
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "step-action-poc");

const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(VARIANTS).filter(
        ([name]) => !only || name === only
    );

    console.log("=== Step action illustration PoC ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} variants\n`);

    let failed = 0;

    for (const [name, variant] of entries) {
        try {
            console.log(`Generating ${name} — ${variant.note}`);

            const { base64Data, mimeType } = await generateImage({
                prompt: variant.prompt,
                model: MODEL,
                aspectRatio: variant.aspectRatio,
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\nWritten to ${OUT_DIR}`);
    if (failed) console.log(`${failed} failed`);
}

main();
