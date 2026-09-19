// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildFoodIllustrationStyle, generateImage } from "@fridgeezy/genai";

/**
 * Three candidate STORIES for the welcome screen's cross-fade.
 *
 * The screen cycles paintings behind three claims — "From your Fridge", "Meals
 * that Work", "Real-Time Changes" — and what shipped first tells only the first
 * of them: a ring of raw ingredients becoming a bowl. Each set below is a
 * sequence whose beats map onto the card underneath it, so the picture narrates
 * the features instead of decorating them.
 *
 * ## The one rule every set obeys: ONE CAMERA, ONE FOOTPRINT
 *
 * A cross-fade between two paintings reads as a transformation only if the two
 * occupy the same place at the same scale; otherwise it is a slideshow, and a
 * slideshow of food is what every other app's onboarding already is. So every
 * prompt in a set pins the arrangement to the centre of the frame at the same
 * size, and the sets are generated together and must be regenerated together.
 *
 * The pair this replaces got that by luck — the raw ring came back with an open
 * centre and the bowl landed in it — and luck is what these prompts are trying
 * to make deliberate.
 *
 * ## Why three beats and not two
 *
 * Three claims. A two-state loop can only ever say one thing, and the third
 * beat is where the hardest claim gets performed rather than described:
 * "Real-Time Changes" cannot be painted in a single frame, but a dish that
 * visibly becomes a different dish IS the change, happening while you watch.
 *
 * ## The trade every set carries
 *
 * A three-beat loop at the screen's current cadence runs about 20 seconds, so a
 * reader who leaves in five never sees beat three. That is acceptable for a
 * story whose beats are each true on their own, and fatal for one that only
 * makes sense complete — which is why none of these is a narrative with an
 * ending. Each frame has to be a good first frame.
 */

/** Said to every scene — see `generate-client-art`, where it is not boilerplate. */
const SINGLE_IMAGE_RULE = `- This is ONE single illustration of ONE subject, filling the whole frame as a single continuous picture. Never a grid, contact sheet, collage, diptych, triptych, quadtych, mood board, set of variations, or a frame divided into panels or quadrants by any line, gutter or border.`;

/**
 * The registration clause, repeated verbatim in every prompt.
 *
 * It is worded as a place and a size rather than as "the same as the last
 * image", because each call is independent and the model has never seen the
 * others.
 */
const FOOTPRINT = `- The whole arrangement sits in the MIDDLE of the square frame and fills about four fifths of its width, leaving an even margin of empty ground all the way round. It is never cropped by an edge.`;

const scene = (subject: string, emphasis: string, mood: string) => ({
    aspectRatio: "1:1" as const,
    prompt: `${subject}
${FOOTPRINT}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the arrangement is centred in the square and fills about four fifths of its width, with an even margin of empty ground on all four sides. Nothing is cropped by an edge and nothing sits in the corners.",
    renderingEmphasis: emphasis,
    mood,
})}`,
});

/** Raw ingredients need the vessel rule turned off; the dishes do not. */
const rawScene = (subject: string, emphasis: string, mood: string) => ({
    aspectRatio: "1:1" as const,
    prompt: `${subject}
${FOOTPRINT}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    vessel: "none",
    camera: "overhead",
    framing:
        "the arrangement is centred in the square and fills about four fifths of its width, with an even margin of empty ground on all four sides. Nothing is cropped by an edge and nothing sits in the corners.",
    renderingEmphasis: emphasis,
    mood,
})}`,
});

/**
 * The one dish the before/after pair is about, described IDENTICALLY in both
 * prompts except for the single component that changes.
 *
 * This is the whole technique. Two independent generations will never produce
 * "the same dish with one thing different" if they are asked in two different
 * ways — so the vessel, the pasta, the sauce, the garnish, the angle and the
 * plating are one string used twice, and the only free variable is what is
 * running through it. A reader is then looking at a swap rather than at two
 * dinners.
 *
 * Prawns to mushrooms because the change has to survive a cross-fade at phone
 * size: coral pink to deep brown is legible at a glance, where two pale
 * proteins would read as the picture wobbling.
 */
const SWAP_DISH = (through: string) =>
    `Editorial illustration of one bowl of pasta, seen from directly above.
- ONE shallow round ceramic bowl, dead centre, and nothing else in the picture.
- It holds wide ribbon pasta turned in a pale cream sauce, gathered into a soft nest that fills the bowl.
- ${through}
- A few torn green basil leaves are scattered over the top, and there is a light grind of pepper.
- The bowl, the pasta, the sauce, the basil and the framing are exactly as described; nothing else is added.`;

/**
 * The plating discipline the RECIPE HERO images are drawn with, brought over.
 *
 * The welcome frames were overhead and homely — a generous bowl of food seen
 * from above — and beside a recipe card they looked like a different app's
 * pictures. The heroes are `create-recipe-image`'s: the shared style's DEFAULT
 * three-quarter camera, Michelin restraint, one confident gesture surrounded by
 * empty plate, detail concentrated on the centrepiece.
 *
 * **Overhead was never the house look; it was a per-surface exception.** The
 * medallions take it because a circle survives a round mask, and the cuisine
 * tiles because several dishes at 45 degrees occlude each other at 110pt. The
 * welcome screen is neither — it is a big picture with nothing cropping it, so
 * it should look like the app's own food, and the app's own food is plated.
 *
 * Trimmed from the recipe version: the unit-versus-mass rule and the counted
 * garnish clause buy nothing when the dish is named here and is always a mass.
 */
const PLATING = (dish: string) => `PLATING
- A complete, appetising restaurant portion of ${dish} — generous enough to read as a real serving. Refine and elevate the presentation; never deconstruct it into a sparse arrangement of isolated pieces.
- Compose rather than pile: a clear centrepiece, components placed with intent, and the vessel's rim left clean so the food sits in a ring of calm negative space.
- Add one controlled sauce element and one considered finishing garnish, both belonging to this dish.
- Build height, layering and textural contrast — crisp against soft, glossy against matte.
- Restraint is the point. The food occupies a compact area near the centre of the vessel and no more than half its surface; the surrounding plate stays genuinely empty.`;

/** The dish the story follows, so every frame is recognisably the same dinner. */
const PASTA = "tagliatelle in a pale cream sauce";

const SCENES = {
    // ===================================================================
    // SET E — three beats, and what shipped
    //
    // D's four beats collapse to three (owner's call, 2026-09-18):
    //
    // - The ingredients are a HEAP, not a ring. The ring existed so a bowl
    //   could land in its hole, and with the middle beat gone there is no
    //   bowl to land — so the arrangement went back to being a pile of food
    //   somebody set down. The model reaches for a wreath every time it is
    //   given loose produce and an even margin, so the ban is explicit and
    //   lists the shapes by name.
    // - The before and after are ONE FRAME. Two bowls side by side, the
    //   same dish in both, one thing different between them. A cross-fade
    //   made the reader hold the first bowl in their head to see the
    //   change; side by side the comparison is just there, and it costs a
    //   beat rather than buying one.
    // - The menu frame is D's, unchanged.
    //
    // Two candidates each for the two that moved, because a heap and a
    // side-by-side are both arrangements the model has strong opinions
    // about.
    // ===================================================================
    eHeap: rawScene(
        `Editorial illustration of a generous gathering of raw ingredients, seen from directly above.
- A loose, abundant group of raw produce shown as itself: leafy greens, two or three round vegetables, a root vegetable, a bulb of garlic, a few herbs and a scatter of small things.
- They lie close together and OVERLAP each other in a natural, casual pile — a heap somebody set down, not an arrangement.
- The pile is DENSEST THROUGH THE MIDDLE of the frame and thins toward the edges. There is no empty space at its centre.
- Nothing is arranged into a ring, wreath, circle, garland, border, spiral, grid or row, and nothing is evenly spaced.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.`,
        "The pile is deepest at the centre of the frame and the greens are the tallest note.",
        "abundant and everyday — what you already have in."
    ),
    eHeapTight: rawScene(
        `Editorial illustration of an armful of raw ingredients set down together, seen from directly above.
- Raw produce piled in one close group: a bunch of leafy greens laid across the middle, two round vegetables tucked against it, a couple of carrots angled over the top, a bulb of garlic, a sprig of herbs and a few loose small things.
- They OVERLAP heavily and lean on each other, at different angles, the way things fall when they are put down rather than placed.
- The group is one solid mass through the centre of the frame with no gap in the middle.
- Nothing is arranged into a ring, wreath, circle, garland, border, spiral, grid or row.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.`,
        "The group reads as one overlapping mass rather than as separate items, and the carrots crossing it are the strongest lines.",
        "casual and generous — the week's shopping, just in."
    ),
    eSwap: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial illustration of the same pasta dish twice, side by side, seen from directly above.

SUBJECT
- TWO shallow round ceramic bowls of exactly the same size, shape and colour, sitting side by side on bare ground with a small gap between them. Both are fully visible and neither is cropped.
- This is ONE continuous picture of two bowls standing next to each other — never a split frame, a panel, a before-and-after chart, an arrow, a divider or a label of any kind.
- Both hold the SAME dish: wide ribbon pasta turned in a pale cream sauce, gathered into a soft nest, with torn green basil leaves over the top.
- The bowl on the LEFT has PRAWNS through its pasta — curled, coral pink, clearly visible against the sauce.
- The bowl on the RIGHT has ROASTED MUSHROOMS through its pasta instead — sliced, deep golden brown, clearly visible against the sauce. There are no prawns and no seafood of any kind in the right bowl.
- Everything else about the two bowls is identical, so the only difference anyone can find is what is running through the pasta.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the two bowls sit side by side across the middle of the square frame and together fill about four fifths of its width, with an even margin of empty ground above, below and to each side. Neither bowl is cropped by an edge.",
    renderingEmphasis:
        "The two bowls are drawn as twins — same rim, same nest of pasta, same basil — so the coral prawns on one side and the brown mushrooms on the other are the only thing that differs.",
    mood: "the same dinner, two ways.",
})}`,
    },
    eSwapClose: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial illustration of the same pasta dish twice, in two overlapping bowls, seen from directly above.

SUBJECT
- TWO shallow round ceramic bowls of exactly the same size, shape and colour, set close together so their rims very slightly OVERLAP — one a little higher in the frame and to the left, the other a little lower and to the right. Both are almost entirely visible.
- This is ONE continuous picture of two bowls standing next to each other — never a split frame, a panel, a before-and-after chart, an arrow, a divider or a label of any kind.
- Both hold the SAME dish: wide ribbon pasta turned in a pale cream sauce, gathered into a soft nest, with torn green basil leaves over the top.
- The UPPER LEFT bowl has PRAWNS through its pasta — curled, coral pink, clearly visible against the sauce.
- The LOWER RIGHT bowl has ROASTED MUSHROOMS through its pasta instead — sliced, deep golden brown, clearly visible against the sauce. There are no prawns and no seafood of any kind in that bowl.
- Everything else about the two bowls is identical, so the only difference anyone can find is what is running through the pasta.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    framing:
        "the pair of bowls sits centred in the square frame and together fills about four fifths of its width and height, with an even margin of empty ground all the way round. Neither bowl is cropped by an edge.",
    renderingEmphasis:
        "The two bowls are drawn as twins — same rim, same nest of pasta, same basil — so the coral prawns in one and the brown mushrooms in the other are the only thing that differs.",
    mood: "the same dinner, two ways.",
})}`,
    },

    // ===================================================================
    // SET F — the same story, drawn like the RECIPE HEROES
    //
    // Three-quarter and plated, not overhead and homely. The heap stays as
    // it is — it is raw produce and has no plating to do — so only the two
    // dishes are re-drawn.
    //
    // The swap frame gets three attempts at the same problem, because "show
    // that we changed it" is a composition question rather than a subject
    // one, and side-by-side twins were the obvious answer rather than the
    // best one.
    // ===================================================================
    fSwapStack: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of one dish served two ways, in two bowls, one behind the other.

SUBJECT
- TWO shallow ceramic bowls of the same size and shape holding the SAME dish, arranged as a hero and its companion: one front and centre, fully visible and the sharpest thing in the picture; the second tucked BEHIND it and offset to one side, partly hidden by the first, so they read as a pair rather than a row.
- The FRONT bowl's pasta has ROASTED MUSHROOMS through it — sliced, deep golden brown, clearly visible.
- The BOWL BEHIND has PRAWNS through its pasta instead — curled, coral pink, clearly visible in the part of it that shows. There is no seafood in the front bowl.
- Everything else about the two is identical: the same vessel, the same nest of pasta, the same sauce, the same garnish. The only difference anyone can find is what is running through them.
- No cutlery, no cloth, no hands, no second arrangement.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the two bowls together are centred in the frame and fill about four fifths of its width, with an even margin of empty ground on all four sides. Neither bowl is cropped by an edge.",
    renderingEmphasis:
        "Detail is concentrated on the front bowl and falls away toward the one behind it, so the eye lands on the hero first and finds its twin second.",
    mood: "the same dinner, reconsidered.",
})}`,
    },
    fSwapPair: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of one dish served two ways, in two bowls side by side.

SUBJECT
- TWO shallow ceramic bowls of exactly the same size and shape, set side by side and very slightly apart, both fully visible and seen at the same angle.
- Both hold the SAME dish, plated identically.
- The LEFT bowl's pasta has PRAWNS through it — curled, coral pink, clearly visible.
- The RIGHT bowl's pasta has ROASTED MUSHROOMS through it instead — sliced, deep golden brown, clearly visible. There is no seafood in the right bowl.
- Everything else about the two is identical, so the only difference anyone can find is what is running through them.
- One continuous picture of two bowls on the same ground — never a split frame, a panel, a chart, an arrow, a divider or a label.
- No cutlery, no cloth, no hands.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the pair of bowls is centred in the frame and together fills about four fifths of its width, with an even margin of empty ground on all four sides. Neither bowl is cropped by an edge.",
    renderingEmphasis:
        "The two bowls are drawn as twins so the coral in one and the brown in the other is the only thing that differs.",
    mood: "the same dinner, two ways.",
})}`,
    },
    fSwapPlated: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of one plated dish, with the ingredient it was changed for resting beside the plate.

SUBJECT
- ONE shallow ceramic bowl, front and centre, holding the dish plated with restraint. Its pasta has ROASTED MUSHROOMS through it — sliced, deep golden brown, clearly visible.
- Resting on the bare ground just beside the bowl and clearly OUTSIDE it, a small deliberate group of THREE raw prawns — curled, coral pink, uncooked — set down as if they had been taken out of the dish and put aside. They are the only thing outside the vessel.
- The prawns are placed with intent, not scattered: a tight little group at one side of the bowl, close to its rim but not touching the food.
- No cutlery, no cloth, no hands, no second bowl.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the bowl and the small group beside it are centred together in the frame and fill about three quarters of its width, with an even margin of empty ground on all four sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "Detail is concentrated on the bowl; the prawns beside it are quieter and read clearly as raw and set aside.",
    mood: "one swap, and the thing it replaced.",
})}`,
    },
    fMeal: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of a main course and the dishes served with it.

SUBJECT
- ONE shallow ceramic bowl of the main dish, front and centre, the largest vessel and the sharpest thing in the picture.
- TWO smaller plates tucked BEHIND it at different distances and angles, partly hidden by the main bowl: one holding a small leafy salad, one holding a warm roasted side. A small dish of sauce sits close beside the main bowl.
- They read as ONE MEAL served together — a main and what goes with it — never four equal dishes in a row or a grid.
- Every vessel is the same matte ceramic family.
- No cutlery, no cloth, no hands, no glasses.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    framing:
        "the whole arrangement is centred in the frame and fills about four fifths of its width, with an even margin of empty ground on all four sides. Nothing is cropped by an edge.",
    renderingEmphasis:
        "Detail is concentrated on the main bowl and falls away toward the dishes behind it, so the eye lands on the hero first.",
    mood: "generous and composed — one dish, and everything that came with it.",
})}`,
    },

    fSwapStackDark: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of one dish served two ways, in two bowls, one behind the other, glowing out of a deep dark field.

SUBJECT
- TWO shallow ceramic bowls of the same size and shape holding the SAME dish: one front and centre, fully visible and the sharpest thing in the picture; the second tucked BEHIND it and offset to one side, partly hidden by the first.
- The FRONT bowl's pasta has ROASTED MUSHROOMS through it — sliced, deep golden brown, clearly visible.
- The BOWL BEHIND has PRAWNS through its pasta instead — curled, coral pink, clearly visible in the part of it that shows. There is no seafood in the front bowl.
- Everything else about the two is identical. The only difference anyone can find is what is running through them.
- No cutlery, no cloth, no hands.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the two bowls together are centred in the frame and fill about four fifths of its width, with an even margin of dark ground on all four sides. Neither bowl is cropped, and there is no pale border at the edges of the square.",
    renderingEmphasis:
        "Detail is concentrated on the front bowl and falls away toward the one behind it.",
    mood: "the same dinner, reconsidered, at night.",
})}`,
    },
    fMealDark: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial food illustration of a main course and the dishes served with it, glowing out of a deep dark field.

SUBJECT
- ONE shallow ceramic bowl of the main dish, front and centre, the largest vessel and the sharpest thing in the picture.
- TWO smaller plates tucked BEHIND it at different distances and angles, partly hidden by the main bowl: one holding a small leafy salad, one holding a warm roasted side. A small dish of sauce sits close beside the main bowl.
- They read as ONE MEAL served together — a main and what goes with it — never four equal dishes in a row or a grid.
- No cutlery, no cloth, no hands, no glasses.

${PLATING(PASTA)}
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the whole arrangement is centred in the frame and fills about four fifths of its width, with an even margin of dark ground on all four sides. Nothing is cropped, and there is no pale border at the edges of the square.",
    renderingEmphasis:
        "Detail is concentrated on the main bowl and falls away toward the dishes behind it.",
    mood: "generous and quiet — one dish and everything that came with it, at night.",
})}`,
    },

    // ===================================================================
    // SET E, DARK — the three that shipped, again on a dark ground
    //
    // Every generated asset bakes its ground into the JPEG, so a cream
    // painting full-bleed behind a dark page is a lit slab above dark copy
    // — the failure `onArtwork` exists to name, and why the welcome screen
    // has always been a themed PAIR. `low-key` rewrites four of the eight
    // FIXED STYLE lines (watercolour cannot survive a dark ground, so the
    // paint turns opaque), which is why these are eyeballed rather than
    // trusted.
    //
    // The subjects are worded identically to their light twins except for
    // the ground: a reader switching theme should see the same picture, not
    // a different photograph of the same idea.
    // ===================================================================
    eHeapDark: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial illustration of a generous gathering of raw ingredients, seen from directly above, glowing out of a deep dark field.

SUBJECT
- A loose, abundant group of raw produce shown as itself: leafy greens, two or three round vegetables, a root vegetable, a bulb of garlic, a few herbs and a scatter of small things.
- They lie close together and OVERLAP each other in a natural, casual pile — a heap somebody set down, not an arrangement.
- The pile is DENSEST THROUGH THE MIDDLE of the frame and thins toward the edges. There is no empty space at its centre.
- Nothing is arranged into a ring, wreath, circle, garland, border, spiral, grid or row.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    vessel: "none",
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the pile is centred in the square and fills about four fifths of its width, with an even margin of dark ground on all four sides. There is no pale margin anywhere and no lighter border at the edges of the square.",
    renderingEmphasis:
        "The pile is deepest at the centre of the frame and is the only light in the picture.",
    mood: "abundant and quiet — what you already have in, at night.",
})}`,
    },
    eSwapCloseDark: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial illustration of the same pasta dish twice, in two overlapping bowls, seen from directly above, glowing out of a deep dark field.

SUBJECT
- TWO shallow round ceramic bowls of exactly the same size, shape and colour, set close together so their rims very slightly OVERLAP — one a little higher in the frame and to the left, the other a little lower and to the right. Both are almost entirely visible.
- This is ONE continuous picture of two bowls standing next to each other — never a split frame, a panel, a before-and-after chart, an arrow, a divider or a label of any kind.
- Both hold the SAME dish: wide ribbon pasta turned in a pale sauce, gathered into a soft nest, with torn green basil leaves over the top.
- The UPPER LEFT bowl has PRAWNS through its pasta — curled, coral pink, clearly visible.
- The LOWER RIGHT bowl has ROASTED MUSHROOMS through its pasta instead — sliced, deep golden brown, clearly visible. There are no prawns and no seafood of any kind in that bowl.
- Everything else about the two bowls is identical, so the only difference anyone can find is what is running through the pasta.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the pair of bowls sits centred in the square frame and together fills about four fifths of its width and height, with an even margin of dark ground all the way round. Neither bowl is cropped, and there is no pale border at the edges of the square.",
    renderingEmphasis:
        "The two bowls are drawn as twins, so the coral prawns in one and the brown mushrooms in the other are the only thing that differs.",
    mood: "the same dinner, two ways, at night.",
})}`,
    },
    eMealDark: {
        aspectRatio: "1:1" as const,
        prompt: `Editorial illustration of several dishes that go together, seen from directly above, glowing out of a deep dark field.

SUBJECT
- FOUR ceramic vessels of the same family, gathered close together so they overlap slightly: one larger shallow bowl of pasta in a pale sauce at the centre, and around it a plate of something green and leafy, a small bowl of a warm roasted side, and a small dish of sauce.
- They read as ONE MEAL laid out together — courses that belong to each other — rather than four unrelated dishes.
- The central pasta bowl is clearly the largest and the others cluster against its rim.
- No cutlery, no cloth, no hands, no glasses.
${SINGLE_IMAGE_RULE}

${buildFoodIllustrationStyle({
    camera: "overhead",
    tone: "low-key",
    ground: { name: "deep warm brown-black", hex: "#141110" },
    framing:
        "the group is centred in the square and fills about four fifths of its width, with an even margin of dark ground on all four sides. There is no pale margin anywhere and no lighter border at the edges of the square.",
    renderingEmphasis:
        "The overlapping rims are the strongest pattern and the dishes are the only light in the picture.",
    mood: "generous and quiet — one dish and everything that goes with it, at night.",
})}`,
    },

    // ===================================================================
    // SET D — the story, told properly
    //
    // Four beats: what you have, a dish, THAT DISH CHANGED, and a meal
    // built around it. It abandons the one-beat-per-claim mapping the
    // earlier sets were built on — the card can say whatever the picture
    // needs it to, and a story that reads is worth more than a legend that
    // matches.
    //
    // Beats two and three are a genuine BEFORE AND AFTER (see `SWAP_DISH`),
    // which is the only honest way to draw "change a recipe": one frame
    // cannot show a change, and two nearly-identical frames can show
    // nothing else.
    // ===================================================================
    dFridge: rawScene(
        `Editorial illustration of raw ingredients gathered in a ring, seen from directly above.
- A generous gathering of raw ingredients shown as themselves: leafy greens, a couple of round vegetables, a root vegetable, herbs and a scatter of small things.
- They form a broad RING with a clear, completely empty circle of bare ground at its centre — nothing at all sits in the middle.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.`,
        "The ring is densest in its band and opens to bare ground at the exact centre of the frame.",
        "abundant and everyday — what you already have in."
    ),
    dBefore: scene(
        SWAP_DISH(
            "Running through the pasta are PRAWNS — eight or nine of them, curled, coral pink, clearly visible against the pale sauce."
        ),
        "The prawns are the strongest colour in the bowl and read individually against the cream.",
        "one good dish."
    ),
    dAfter: scene(
        SWAP_DISH(
            "Running through the pasta are ROASTED MUSHROOMS — eight or nine of them, sliced, deep golden brown, clearly visible against the pale sauce. There are no prawns and no seafood of any kind in the bowl."
        ),
        "The mushrooms are the strongest colour in the bowl and read individually against the cream, exactly where prawns would otherwise sit.",
        "the same dish, made another way."
    ),
    dMenu: scene(
        `Editorial illustration of several dishes that go together, seen from directly above.
- FOUR ceramic vessels of the same family, gathered close together so they overlap slightly: one larger shallow bowl of pasta in a pale sauce at the centre, and around it a plate of something green and leafy, a small bowl of a warm roasted side, and a small dish of sauce.
- They read as ONE MEAL laid out together — courses that belong to each other — rather than four unrelated dishes.
- The central pasta bowl is clearly the largest and the others cluster against its rim.
- No cutlery, no cloth, no hands, no glasses.`,
        "The overlapping rims are the strongest pattern, and the central bowl's circle dominates the group.",
        "generous and hospitable — one dish, and everything that goes with it."
    ),
    // An alternate third act: the meal seen as a ROW of courses in the order
    // they are eaten, rather than a cluster. Kept as a candidate because a
    // cluster says "a spread" and a row says "a menu", and which of those
    // "Meals that Work" means is a decision rather than a drawing.
    dMenuRow: scene(
        `Editorial illustration of a menu of three courses, seen from directly above, laid out in a row.
- THREE ceramic vessels of the same family in a single horizontal row across the middle of the frame, evenly spaced and not overlapping: a small starter plate on the left, a larger main bowl in the middle, and a small dessert bowl on the right.
- The middle one is clearly the largest, so the row reads as a meal with a main course rather than three equal dishes.
- Their contents differ clearly: something green and fresh, something warm and golden, something soft and pink or berry.
- No cutlery, no cloth, no hands, no glasses.`,
        "The three rims sit on one horizontal line and the middle one is the largest circle in the picture.",
        "a proper meal, in the order you will eat it."
    ),

    // ===================================================================
    // SET A — "what you have → dinner → dinner, changed"
    //
    // The literal map of the three claims, and the only set whose third
    // beat performs "Real-Time Changes". Beats two and three are the SAME
    // BOWL holding a different dish, so the cross-fade between them is the
    // feature.
    // ===================================================================
    aIngredients: rawScene(
        `Editorial illustration of raw ingredients gathered in a ring, seen from directly above.
- A generous gathering of raw ingredients shown as themselves: leafy greens, a couple of round vegetables, a root vegetable, herbs and a scatter of small things.
- They form a broad RING with a clear, completely empty circle of bare ground at its centre — nothing at all sits in the middle.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.`,
        "The ring is densest in its band and opens to bare ground at the exact centre of the frame.",
        "abundant and everyday — what you already have in."
    ),
    aDish: scene(
        `Editorial illustration of one finished dish, seen from directly above.
- ONE large round ceramic bowl holding a complete, generous, warm savoury dish — golden and amber, with a green herb note over it.
- The bowl is the only object in the picture and sits dead centre.
- It is unmistakably cooked and ready to eat: no raw ingredients anywhere.`,
        "The bowl's rim is the strongest circle in the picture and its contents are warm and golden.",
        "warm and complete — dinner, made."
    ),
    aVariant: scene(
        `Editorial illustration of one finished dish, seen from directly above — a lighter, greener version of a warm bowl dish.
- ONE large round ceramic bowl, the SAME size and shape and in the SAME dead-centre position as a warm golden bowl dish would be.
- What it holds is clearly a DIFFERENT dish from a golden stew: fresh and green — leaves, herbs, pale grains, a few bright vegetables — light where the other was rich.
- It is unmistakably cooked and ready to eat, plated with the same care.`,
        "The bowl matches a golden dish's vessel exactly; only what is in it has changed, and it is green and fresh where the other is amber.",
        "the same dinner, made another way."
    ),

    // ===================================================================
    // SET B — "what you have → one dish → the meal around it"
    //
    // Beat three KEEPS the centre plate and adds around it, so the
    // cross-fade shows a meal assembling. The strongest "Meals that Work",
    // and it says nothing about changing a recipe.
    // ===================================================================
    bIngredients: rawScene(
        `Editorial illustration of a small gathering of raw ingredients, seen from directly above.
- A loose, low heap of raw produce shown as itself: leafy greens, two round vegetables, a root vegetable and a few herbs, overlapping each other.
- They gather into a roughly circular group in the centre of the frame.
- Everything is raw and whole. No vessel, no bag, box, basket, net, paper or wrapping of any kind.`,
        "The group is densest at the centre and the greens are the tallest note.",
        "abundant and everyday — what you already have in."
    ),
    bDish: scene(
        `Editorial illustration of one plated main course, seen from directly above.
- ONE large round ceramic plate holding a generous main dish, dead centre, and nothing else at all in the picture.
- Around it is bare, empty ground on every side.
- It is unmistakably a finished main course, warm and golden with a herb note.`,
        "The plate is a single strong circle in the middle of an otherwise empty frame.",
        "one good dish."
    ),
    bTable: scene(
        `Editorial illustration of one main course surrounded by the smaller dishes that go with it, seen from directly above.
- ONE large round ceramic plate holding a warm golden main, dead centre and at the SAME size it would be alone in the frame.
- Gathered close around it, THREE much smaller ceramic bowls of side dishes — one green and leafy, one soft pink or berry, one pale and creamy — overlapping the big plate's rim.
- The size difference is obvious: one hero and its companions, never four equal dishes.`,
        "The big plate's circle still dominates; the small rims cluster against it and stay crisp.",
        "generous and hospitable — one dish, and everything that came with it."
    ),

    // ===================================================================
    // SET C — "the shelf → the prep → the table"
    //
    // The cooking journey, and the most literal answer to "From your
    // Fridge": beat one is a shelf, in rows, the way a fridge is. It is the
    // only set whose first frame is not a heap.
    // ===================================================================
    cShelf: rawScene(
        `Editorial illustration of a shelf of ingredients seen from directly above, laid out in neat rows.
- Raw ingredients arranged in two or three tidy horizontal ROWS, the way things sit on a shelf: leafy greens along one row, round vegetables along another, roots and herbs along a third.
- They are lined up and evenly spaced rather than heaped, and the rows fill the middle of the frame.
- Everything is raw and whole. No shelf, rack, fridge, box, bag or container is drawn — only the food and its arrangement.`,
        "The horizontal rows are the strongest structure in the picture and stay clearly separated.",
        "orderly and full — the shelves, before anything is decided."
    ),
    cPrep: scene(
        `Editorial illustration of prepared ingredients in small bowls, seen from directly above.
- FIVE or SIX small ceramic bowls of the same family, gathered close together in the middle of the frame, each holding one prepared component: chopped vegetables, torn herbs, a pale grain, a sauce, something sliced.
- The bowls overlap slightly and cluster into a rough circle.
- Everything in them is prepared but not yet cooked into a dish.`,
        "The cluster of small rims is the strongest pattern in the picture.",
        "halfway there — everything ready to go in."
    ),
    cTable: scene(
        `Editorial illustration of a finished meal on the table, seen from directly above.
- One large plated main with real height, two smaller side bowls and a small pool of sauce, gathered close together in the middle of the frame.
- Everything is cooked, plated and ready to eat.
- No cutlery, no cloth, no hands, no glasses.`,
        "The overlapping rims are the strongest shapes and the main plate is the largest circle.",
        "warm and generous — the moment everything reaches the table."
    ),
};

const MODEL = (process.env.GENAI_IMAGE_MODEL ??
    "gemini-3.1-flash-image") as Parameters<typeof generateImage>[0]["model"];

const OUT_DIR = join(process.cwd(), "operations", "output", "welcome-story");

/** This endpoint returns JPEG; see `generate-splash`. */
const extensionFor = (mimeType: string) =>
    mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = Object.entries(SCENES).filter(
        ([name]) => !only || name.startsWith(only)
    );

    console.log("=== Welcome story candidates ===\n");
    console.log(`Model: ${MODEL}`);
    console.log(`${entries.length} scenes\n`);

    let failed = 0;

    for (const [name, sceneDef] of entries) {
        try {
            console.log(`Generating ${name}...`);

            const { base64Data, mimeType } = await generateImage({
                prompt: sceneDef.prompt,
                model: MODEL,
                aspectRatio: sceneDef.aspectRatio,
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
    console.log(
        "\n`--only=a` / `=b` / `=c` re-rolls one whole set. Re-roll SETS, never\n" +
            "single frames: the registration between beats is the whole effect."
    );
    if (failed > 0) process.exitCode = 1;
}

main();
