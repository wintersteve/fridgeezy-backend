import { supabaseAdmin } from "@fridgeezy/supabase";

const BUCKET = "art_direction";

/**
 * What the image model is shown alongside the recipe prompt, so a new dish is
 * drawn in the same hand as the ones already approved.
 *
 * ## Why pictures at all
 *
 * The style block is eight lines of prose that have been rewritten repeatedly
 * to pin down things prose is bad at — how high the camera stands, how loose a
 * wash is, how much of a bowl's inner wall shows. Measured across the catalogue
 * it did not hold: two dishes rendered minutes apart came back at different
 * camera heights with their shadows falling in opposite directions, one of them
 * the direction the block forbids. Three anchors fixed that in a single round,
 * on the same model and with the prompt otherwise untouched.
 *
 * ## The set is ORDERED and each one is here for a reason
 *
 * Not a gallery of nice pictures — a spanning set. Between them they have to
 * show every kind of surface a dish can have, because the prompt tells the
 * model that what the anchors have in COMMON is the style, and a set that
 * agrees about something incidental teaches that instead. The set ran as two
 * pale, quiet bowls for a while and the Teriyaki Salmon kept coming back
 * unglazed: nothing in the set had a browned or glossy surface, so "pale" read
 * as house style. Adding the Kiev fixed it in one round.
 *
 * The third slot has now been spent twice over, and the second time is the
 * sharper lesson. It held a Chicken Kiev — a browned dish, added because two
 * pale bowls had taught the model that pale WAS the style. What nobody noticed
 * is that all three were BOWLS, so bowl became the style too, and a Margherita
 * pizza came back shrunk into a deep bowl sitting in a pool of sauce. The
 * prompt was never the problem: `VESSEL_RULE` says the vessel's shape follows
 * the dish, and with no anchors at all the same prompt draws that pizza on a
 * flat plate.
 *
 * Steak Frites replaced it — a flat PLATE and a seared subject, so the set
 * stopped agreeing about the vessel — and that lasted about an hour. It fixed
 * the pizza and broke something harder to name: rendered against a plate shot
 * from higher up, every plated dish came back at THAT camera, and a pizza no
 * longer lined up with a tataki. The anchors had started disagreeing about the
 * one thing they must agree on.
 *
 * So the vessel moved OUT of the pictures and into prose — see the VESSEL rule
 * in the prompt, which decides it by class of dish — and the third slot went to
 * a Margherita pizza drawn against the two bowls, at their camera, on a plate.
 * The set now agrees about the register and carries a plated example without
 * teaching a second viewpoint. Verified on the three dishes that disagree: a
 * curry kept its bowl, steak frites and an apple tart came out on plates, and
 * the tart is the one that counts — both bowl anchors are bowls and the Matcha
 * is itself a dessert in one.
 *
 * ## Slots four to six: the vessels prose could not reach
 *
 * A ramekin and two glasses, added when sauces and layered desserts kept being
 * served as courses — a ketchup in a dinner bowl, a red pesto drawn as the
 * plate of pasta it gets stirred into. A written rule for it held for about one
 * render in two, which is the same lesson the pizza taught: prose loses to
 * pictures, so the picture has to exist.
 *
 * All three are ONE-OFF generations rather than catalogue art, made against
 * slots one to three with only the vessel forced by name, so they inherit the
 * camera and the paint and differ in the one thing they were made to teach.
 * `buildRecipeImagePrompt`'s `vessel` option is how, and `install-style-anchor`
 * is what put them here.
 *
 * **They were also moved.** Measured against the first three, which sit with
 * their subject at 0.549-0.551 of the frame's width, these came out at
 * 0.510-0.518 — far enough left to read as a different framing. Each was
 * cropped from its right edge until its subject landed on 0.550. A crop rather
 * than a pad, because padding and replicating an edge is the technique
 * `create-recipe-image` records removing for the artefacts it left on a ground
 * that carries a paper tooth.
 *
 * **That the framing had to be corrected at all is worth remembering**: the
 * style block asks for the subject "precisely centred", and not one of these
 * six obeys it. Whatever the prompt says, the house framing is a little right
 * of centre, because that is where the pictures put it.
 *
 * **That is the rule this set is really built on.** The anchors must agree
 * about the style and disagree about everything else, because the prompt tells
 * the model that what they share IS the style. Three pictures that happen to
 * share a vessel, a palette or a mood will teach it as house style, and it will
 * be obeyed over any line of prose that says otherwise.
 *
 * So a change here is a change to what the app believes its style IS. Before
 * adding a fourth, name the kind of dish the existing three cannot correct —
 * and know the cost: every anchor donates its garnish. A lone bowl of pesto put
 * pine nuts into a Greek salad; with the Matcha added, a sesame tuile followed.
 * The leak lands hardest on dishes shaped like an anchor.
 *
 * Swapping one is an UPLOAD, not a deploy — see the bucket's migration for why
 * that is the whole reason these live in storage.
 */
const ANCHORS = [
    "01-pesto.webp",
    "02-matcha.webp",
    "03-pizza.webp",
    "04-ramekin.webp",
    "05-glass.webp",
    "06-glass-mousse.webp",
] as const;

export interface StyleAnchor {
    data: string;
    mimeType: string;
}

/**
 * Cached as a PROMISE rather than a value, and at module scope.
 *
 * A Lambda execution environment generates many images over its life and the
 * anchors never change within one, so this is three storage reads per cold
 * container rather than three per dish. Caching the promise rather than the
 * result is what makes a burst of concurrent generations share one fetch
 * instead of each starting its own — the promotion path fires image generation
 * for every dish in a batch at once.
 */
let cached: Promise<StyleAnchor[]> | undefined;

async function download(name: string): Promise<StyleAnchor | null> {
    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(name);

    if (error || !data) {
        console.error(`[style-anchors] could not read ${name}:`, error);
        return null;
    }

    return {
        data: Buffer.from(await data.arrayBuffer()).toString("base64"),
        mimeType: data.type || "image/jpeg",
    };
}

/**
 * The anchors, or an empty array.
 *
 * **It never throws and never rejects**, and that is the contract the caller is
 * built on: an anchor that cannot be read must cost a dish its house style, not
 * its picture. A recipe drawn in the old register is a mild inconsistency; a
 * recipe with no illustration is a card with a hole in it, and the failure
 * would land on the storage read rather than on anything the reader did.
 *
 * A partial read is treated the same way as a total one. The set is meaningful
 * as a SET — the prompt says what these pictures share is the style — so two
 * thirds of it is not two thirds of the answer, it is a different and untested
 * claim about what the style is. Losing the Kiev, for instance, silently
 * reinstates the paleness that adding it fixed.
 */
export async function fetchStyleAnchors(): Promise<StyleAnchor[]> {
    cached ??= (async () => {
        const anchors = await Promise.all(ANCHORS.map(download));

        if (anchors.some((anchor) => anchor === null)) {
            console.warn(
                "[style-anchors] incomplete set — generating without anchors"
            );
            return [];
        }

        return anchors as StyleAnchor[];
    })().catch((error: unknown) => {
        console.error("[style-anchors] fetch failed:", error);
        return [];
    });

    return cached;
}

/**
 * The GATHERING anchor: one chosen mise-en-place render, by another dish.
 *
 * Separate from {@link fetchStyleAnchors} and deliberately not added to
 * `ANCHORS`, because the two answer different questions. The six style anchors
 * teach a PLATED dish's register; this one teaches a bench before cooking — the
 * camera and its height, the kind of vessels, how they are grouped and spaced.
 * `buildMiseArtPrompt`'s own note records that the camera took three rounds to
 * settle with prose alone and only stopped moving once a picture carried it.
 *
 * Mixing it into the set would be worse than not having it: that set is
 * meaningful AS A SET — the prompt says what those pictures share is the style —
 * so adding a seventh that shares a different thing changes the claim for every
 * hero as well.
 *
 * It lives in storage rather than on disk because the API reads it.
 * `generate-step-art.ts` keeps its own copy at `operations/data/mise-anchor.webp`
 * and reads that; the two are the same image and **must be replaced together**,
 * or the console and the command line start drawing two different benches.
 *
 * Same contract as the set above: never throws, and null costs a picture its
 * anchor rather than its existence — which is exactly what every gathering page
 * drawn before the anchor existed had.
 */
let cachedMise: Promise<StyleAnchor | null> | undefined;

export async function fetchMiseAnchor(): Promise<StyleAnchor | null> {
    cachedMise ??= download("mise-anchor.webp").catch((error: unknown) => {
        console.error("[style-anchors] mise anchor fetch failed:", error);
        return null;
    });

    return cachedMise;
}
