import { buildFoodIllustrationStyle } from "./index";

/**
 * The RECIPE HERO's prompt — the plating half, plus the shared style block.
 *
 * It lives in this library rather than beside the uploader in `apps/api` for
 * the reason the style block itself does: two callers must not keep two copies
 * of a paragraph. The API renders it for real; `render-recipe-art` in
 * `apps/database` renders it to a folder so a change can be looked at before it
 * reaches the catalogue. A review harness comparing a COPY of the prompt would
 * be measuring something the app does not ship, which is worse than no harness.
 */

/**
 * The plating half of the prompt. The style half is shared with the cuisine
 * tiles via `buildFoodIllustrationStyle` — the two render side by side in the
 * app, and keeping the contract in one place is what stops them drifting apart.
 *
 * "Complete, appetising portion … never deconstruct" is a guard, not filler:
 * Michelin plating language on its own shrinks a Caesar salad to two leaves and
 * a smear, which is art-directed but reads as no food at all on a recipe card.
 *
 * That guard needs its own counterweight, though, and the two must be edited as
 * a pair. Read as a quantity instruction it made every dish built from repeated
 * units come back as a full batch — ten macarons scattered across the plate,
 * which is a bakery display, not a plated course. The serving-form bullet is
 * what splits the two cases: a mass dish takes the generous portion, a
 * unit dish takes one to three pieces with a hero. Loosen one side and the other
 * side's failure comes straight back.
 *
 * Garnish is constrained by course for the same reason — asked only for
 * "a considered finishing garnish", the model put savoury herbs on a tiramisu.
 *
 * The two restraint bullets look like a third contradiction of the portion
 * guard and are not: they constrain how much of the *plate* is used, never how
 * much food is served. Both survived a blind A/B (2026-08-04) across five
 * dishes and two models, where this version tied the plain prompt on Gemini 3
 * Pro and beat it on Flash — which is the reason it is the default rather than
 * the plain one. If image quality ever has to fall back to a cheaper model,
 * this is the variant that degrades better.
 */
export const buildRecipeImagePrompt = (
    name: string,
    /**
     * The dish's own ingredients, when the caller has them.
     *
     * Optional, and inert when omitted: the prompt is byte-for-byte what it was
     * before this parameter existed, so adopting it is a call site's decision
     * rather than something that changed under every dish at once.
     *
     * It exists because a NAME does not identify a dish, and both ways that
     * fails are on record. "Sticky Rice" is a PREFIX of a far more famous dish
     * and the model completes it — the catalogue's picture was mango sticky
     * rice, twice more on a re-roll, sitting beside the real Mango Sticky Rice's
     * own near-identical picture. And "Oxtail Soup" names a dish a dozen
     * cuisines make differently: the catalogue drew a pale East Asian broth for
     * a recipe whose ingredients are a red-wine braise with mirepoix, so the
     * complaint reads as "unappetising" when the picture is simply of another
     * soup.
     *
     * The list is the RECIPE's, so it names things nobody sees on a plate —
     * salt, oil, water. Hence "draw what they make" rather than any claim that
     * each one is visible: an instruction to show every ingredient puts the salt
     * on the plate.
     */
    ingredients?: string[],
    /**
     * How many style reference images are attached (see `generateImage`'s
     * `referenceImages`), which adds the clause telling the model what to take
     * from them. Zero or absent adds nothing.
     *
     * The COUNT matters, not just the fact: with more than one, the clause can
     * say the thing that does the real work — what the pictures have in COMMON
     * is the style, and whatever only one of them has is not. That sentence is
     * the answer to the single-reference leak on record, where a lone bowl of
     * pesto put pine nuts and a ring composition into a Greek salad. Two
     * anchors that share a medium and a camera but share no garnish leave the
     * garnish with nothing to be mistaken for.
     *
     * The clause is almost entirely NEGATIVE, and that is the point. A reference
     * is read as "draw this" long before it is read as "draw like this": shown a
     * bowl of pesto, the model reaches for green food in that same bowl. So the
     * clause names the handful of qualities to copy and then spends most of its
     * words on everything it must not carry across.
     *
     * Inert without the image, and sending one without setting this is the
     * failure to expect — the reference then has no instruction attached and is
     * read as the subject.
     */
    options?: {
        styleReferences?: number;
        /**
         * Names the vessel outright, overriding every rule that would otherwise
         * choose one.
         *
         * For ONE-OFF generations whose purpose is to become a style anchor
         * rather than to illustrate a dish — the app never passes it. A set
         * teaches whatever its pictures agree on, so a vessel the set has no
         * example of cannot be taught by prose alone: the pizza sat in a bowl
         * until a plated picture existed to point at. This is how that picture
         * gets made, on the existing anchors so it inherits their camera and
         * medium, with only the vessel forced.
         *
         * Phrase it as the thing, not as a negation — "a small ceramic dipping
         * bowl", not "not a dinner plate".
         */
        vessel?: string;
    }
) => `Editorial food illustration of ${name}, plated with the precision of a Michelin-starred kitchen.

PLATING
- A complete, appetising restaurant portion — generous enough that a diner reads it as a real serving of ${name}. Refine and elevate the presentation; never deconstruct the dish into a sparse, abstract arrangement of a few isolated pieces.
- Compose rather than pile: a clear centrepiece, components placed with intent, and the vessel's rim left clean so the food sits in a ring of calm negative space.
- How much of ${name} appears depends on how it is served. A dish plated as one mass — a salad, curry, pasta, soup, stew, risotto, roast — keeps the generous portion above. A dish made of repeated discrete units — macarons, cookies, dumplings, sushi, canapés, cupcakes, ravioli, tartlets, skewers — is plated as a chef would serve one guest: one hero piece, or at most three, never a batch, a tray, a stack or a row.
- When there are two or three units, arrange them deliberately — one best-formed piece front and centre as the hero, the others tucked slightly behind or resting against it at different angles. Never a grid, never a line, never evenly spaced or repeated at identical angles. One unit may be halved or bitten to reveal its interior layers and texture.
- VESSEL: choose it for ${name} the way a restaurant would, and decide it from the dish alone. Anything loose, wet or eaten with a spoon — soup, stew, curry, risotto, porridge, noodles in broth, a dessert in syrup or cream — belongs in a deep bowl. Anything that holds its own shape and is cut, sliced or picked up — a pizza, a tart, a pie, a roast, a steak, chops, a sandwich, a whole fish, a bake — belongs on a FLAT PLATE and must never be put in a bowl, however shallow. A pizza sitting in a bowl is wrong, and so is a steak.
- IF ${name} IS ITSELF A SAUCE, dressing, condiment, dip, paste, jam, stock, spice mix or any other component rather than a dish made with one — a ketchup, a pesto, a vinaigrette, a mayonnaise, a chutney, a curry paste — then this bullet OVERRIDES the portion, vessel and garnish rules above, and three things change. It is the whole subject and is shown as itself: never draw the dish it would be served with, so no pasta under a pesto, no leaves under a dressing, no chips beside a ketchup and no bread beside a dip. It goes in a SMALL vessel of the kind a condiment is actually served in — a little ramekin, a shallow dipping bowl or a small open jar — never a dinner plate and never a dinner bowl, and never with cutlery beside it, which the shared style forbids outright, and what is in it is a spoonful or two rather than a course. And it takes NO finishing garnish: no micro-herbs, no scattered seeds, no whole spices laid on top. What may appear is a small amount of what it is MADE FROM, resting on the surface beside the vessel rather than arranged on the sauce.
${options?.vessel ? `- THE VESSEL IS FIXED, and this overrides every other rule about what ${name} is served in: it is ${options.vessel}. Draw exactly that, whatever the dish would normally be served in and whatever the attached pictures are served in. Everything else about those pictures — the medium, the palette, the ground, the light — is unchanged and must still be matched exactly. THE CAMERA DOES NOT MOVE: it stays exactly where it stands in the attached pictures, looking down into the vessel from the same height, so this vessel's rim reads as the same wide ellipse as theirs and you are looking down INTO it rather than across at it. Describe that angle through this vessel's own shape, whatever it is, and never by adding a second vessel: nothing is stood inside a bowl or on a plate to borrow its rim. A tall vessel, a narrow one or a transparent one does NOT earn a lower viewpoint: if holding the camera there means less of the side, less of the height or fewer of the layers can be seen, then draw less of them. The vessel changed; the point of view did not.\n` : ""}- Add one controlled sauce element (a still pool, a single swoosh, or a few precise dots — never a flood) and one considered finishing garnish. Both must belong to this dish: savoury dishes take micro-herbs, toasted seeds, citrus zest, shaved cheese or a thin drizzle of oil; sweet dishes take fruit, berries, chocolate, caramel, cream, nuts or a dusting of sugar or cocoa — never savoury herbs or vegetables. The fewer units on the plate, the more this carries the composition: a single piece is never left alone on a bare plate, it is finished with a drizzle, a scatter of fruit or a quenelle beside it.
- Build height, layering and textural contrast — crisp against soft, glossy against matte.
- Unmistakably ${name}: every ingredient the dish is known for stays present and identifiable, in its own natural colour.
${options?.styleReferences ? `- STYLE REFERENCE: ${options.styleReferences === 1 ? "an image is" : `${options.styleReferences} images are`} attached${options.styleReferences > 1 ? ", and what they have in COMMON is the style" : ""}. ${options.styleReferences === 1 ? "It is" : "They are"} the standard for the MEDIUM, the camera height, the palette, the ground, the weight of the linework and the level of finish — match all of those exactly, so this picture and ${options.styleReferences === 1 ? "that one" : "those"} read as the work of one hand on one afternoon.\n- Take NOTHING ELSE from ${options.styleReferences === 1 ? "the attached image" : "the attached images"}. Not ${options.styleReferences === 1 ? "its dish" : "their dishes"}, not the ingredients, not the colours, not the garnish and not the arrangement. THE VESSEL IS NOT THEIRS TO LEND: whatever they are served in, this dish is served in whatever the VESSEL rule above gives it, and if that is a flat plate then a flat plate it is.${options.styleReferences > 1 ? " Anything only ONE of them has is that dish's own and is not part of the style." : ""} The food here is ${name}, drawn as ${name} is actually served, and a viewer who saw ${options.styleReferences === 1 ? "both pictures" : "all of them"} must never think one was copied from another.\n` : ""}${ingredients?.length ? `- These are its ingredients, and it has no others: ${ingredients.join(", ")}. Draw what they make. Add no food that is not among them — in particular nothing belonging to a better-known dish whose name contains "${name}".\n` : ""}- Restraint is the point. The food occupies a compact area near the centre of the vessel and no more than half its surface; the surrounding plate stays genuinely empty. Fewer elements, placed more deliberately, with more space between them than feels necessary.
- Garnish is counted, not scattered: a precise number of pieces you could tally at a glance, each placed individually. No sprinkling, no dusting across the whole plate, no crumbs trailing to the rim.

${buildFoodIllustrationStyle({
    // The client crops this three ways — a 520px 3:4 hero, a 272x200 landscape
    // card crop, and a square list thumb — so the vessel has to survive a centre
    // crop to any of them.
    //
    // The "two thirds" is aspirational and the model does not honour it. Measured
    // over six dishes on 2026-08-04, asking for three quarters and asking for two
    // thirds both render the plate at ~77% of frame width, a smaller difference
    // than the per-dish spread (72–83%). A third phrasing pinning the plate to
    // the middle half of the height did better — it halved the clipping — but
    // still swung between 51% and 87% of frame height across dishes on one
    // prompt. **Rewording this will not reliably change the plate's size.**
    // Adding the margin after generation was tried instead (a deterministic pad
    // to square) and removed for the artefacts it introduced, so this prompt is
    // the only lever there is.
    framing:
        "the vessel is complete and sits a little right of centre, filling about HALF the frame's width and no more, so that a band of empty ground about a quarter of the frame wide runs down the left side and another down the right, and the picture reads as a small object in a large quiet space. Measure it: if the vessel touches, or nearly touches, the left and right thirds of the frame, it is too big — pull back until it does not. The same generous margin runs above and below, so the image still reads when cropped to a square or to a wide banner.",
    renderingEmphasis:
        "Detail is concentrated on the centrepiece and falls away toward the rim, so the eye lands in one place.",
    mood: "spare, exact and expensive — one confident gesture, generously surrounded by empty plate.",
})}`;
