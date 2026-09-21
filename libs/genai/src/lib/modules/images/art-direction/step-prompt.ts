import { buildFoodIllustrationStyle } from "./index";

/**
 * The STEP BAND's prompt — one moment of a method, plus the shared style block.
 *
 * It lives here rather than beside the uploader in `apps/api` for the reason
 * `recipe-prompt` states in full: two callers must not keep two copies of a
 * paragraph, and a harness rendering a COPY measures something the app does not
 * ship. `operations/generate-step-art.ts` is that second caller — the manual
 * path that draws these for a chosen dish while `RECIPE_STEP_ART_ENABLED`
 * stays off.
 *
 * It describes the STEP's result rather than the finished dish — "the pan after
 * this instruction", not "the recipe". A step picture that shows the plated
 * dish is the hero again, twelve times over.
 *
 * The house art direction is used unmodified here, unlike the technique plates:
 * those had to name their ingredients and show a tool because they answer "what
 * does this word mean", where these sit above a sentence that already says what
 * is happening and to what. The band is atmosphere for a cook who is reading,
 * not a definition.
 */
/**
 * The clause that attaches the dish's own HERO to a cook-mode page.
 *
 * ## Why this is not `buildRecipeImagePrompt`'s version
 *
 * That one anchors a dish to pictures of OTHER dishes, so its rule is "take the
 * style and nothing else — not their dish, not their ingredients, not their
 * colours". Here the attached picture is THIS dish, finished, and half the
 * reason for attaching it is subject transfer: the step pictures came back with
 * the dressing barely on the food while the hero shows it pooling and glossy,
 * and no amount of prose fixes a colour the model has not been shown. So this
 * clause deliberately INVITES what the other one forbids — the components'
 * colours and textures — and spends its force on the one thing that must not
 * travel.
 *
 * ## What must not travel, and why it is the whole risk
 *
 * The hero is the dish COMPLETE. `generateImage`'s own note calls a reference a
 * subject magnet, and the magnet here points exactly where these pictures
 * already fail: step 4 of the first real run drew the finished, tossed salad
 * for an instruction that only said to stir the dressing. Attaching a picture
 * of the finished salad makes that likelier, not less likely, so the clause
 * names the failure outright rather than trusting "one moment" to carry it.
 *
 * It is a BOOLEAN where the hero's is a count, because there is exactly one
 * picture this can ever be: the dish's own.
 */
const styleReferenceClause = (dish: string, moment: string) =>
    `- STYLE REFERENCE: an image is attached. It is ${dish} itself, finished and plated — the picture this method ends at.
- MATCH IT EXACTLY for the MEDIUM, the palette, the ground, the light, the weight of the linework and the level of finish, so this picture and that one read as the work of one hand on one afternoon.
- TAKE ITS INGREDIENTS' APPEARANCE TOO, which is the other reason it is attached: whatever colour, gloss and texture this dish's components have there — a sauce's depth, a chilli's red, how wet or dry the food looks — they have here as well, at whatever stage this picture shows them.
- BUT DO NOT DRAW THE DISH IN IT. ${moment} The attached picture is a LATER moment than this one and does not decide what is in the vessel; the instruction above does. Never copy its plating, its vessel, its garnish or its arrangement, and never let it turn this picture into the finished dish. A viewer seeing both must read them as two moments of one recipe, not as the same photograph twice.
- NOTHING THE INSTRUCTION HAS NOT REACHED YET: an ingredient that is in the attached picture because it is added LATER — a garnish, a scattered nut, a herb laid on top at the end — is absent here, however prominent it is there. Draw what is in the pan or bowl at this moment and nothing that is still waiting to go in.`;

export const buildStepArtPrompt = (
    dish: string,
    instruction: string,
    options?: { styleReference?: boolean },
): string =>
    `Editorial illustration of one moment in cooking ${dish}.

SUBJECT
- The state of the food at the END of this instruction, in whatever vessel the instruction implies: ${instruction}
- It shows only what this step produced — not the finished dish, not a later step, and not a plated portion unless this step is the plating.
- ONE vessel, centred, and nothing else in the picture.
- This is ONE single continuous illustration of ONE moment, never a grid, sequence, panel or set of steps.
${
    options?.styleReference
        ? `${styleReferenceClause(
              dish,
              "This picture shows only what THIS instruction produced — which is usually not plated, not finished and not in a serving dish.",
          )}
`
        : ""
}
${buildFoodIllustrationStyle({
    framing:
        "the vessel is centred and fills about two thirds of the frame's width, leaving a generous even margin of empty ground on all four sides. Nothing is cropped by an edge.",
    mood: "mid-method — one moment of a dish being made.",
})}`;

/**
 * The GATHERING PAGE's prompt — every ingredient prepped, before anything is
 * cooked.
 *
 * It lives beside the step prompt because it is the same surface: cook mode's
 * page art, in the same bucket, keyed `<recipe_id>/mise.webp`. `mise` rather
 * than a step number because it is not an instruction — numbering it 0 would
 * put it in the method's own space and make an off-by-one a picture on the
 * wrong page.
 *
 * ## It is the HOUSE THREE-QUARTER camera, and that is a reversal
 *
 * It shipped `camera: "overhead"`, on the shared style's own exception — the one
 * written for the cuisine tiles, whose reason is that several vessels at 45
 * degrees occlude each other. **That reason does not transfer and the exception
 * should not have been taken** (owner's call, 2026-09-20). It was measured at
 * 110pt, where a tile reads as a pattern of colour rather than as a scene; this
 * band is most of the width of a phone, which is the size the same note says to
 * revisit it at.
 *
 * Two things were wrong with it beyond the size. Every OTHER page of cook mode
 * is three-quarter, so the gathering page was the one screen in the flow shot
 * from a different camera — the "two different kitchens" failure the style file
 * exists to prevent, arrived at from the inside. And once the dish's hero was
 * attached as a style reference, the prompt was **fighting its own reference**:
 * the picture said 45 degrees and was to be matched exactly for medium, palette
 * and light, while the words demanded 90.
 *
 * What went with it is the CONCENTRICITY clause. That was a test for a tilted
 * overhead — outer and inner rim as concentric circles — and at three-quarter
 * it is not merely unnecessary but false, since a rim seen at 45 degrees IS an
 * ellipse. The clause in its place asks for the opposite property: vessels
 * arranged in depth rather than laid out on a plan. The hand-made Tuna Tataki
 * mise is still overhead and is now the odd one out; it is a hand-made fixture
 * and nothing regenerates it.
 *
 * ## Nothing is dropped, and that is the whole reason it groups instead
 *
 * The gathering page is the one picture a cook uses to check they have
 * everything, so an ingredient missing from it is not an untidy composition —
 * it is the app telling them they do not need something they do. Hence the
 * instruction to put the small liquid seasonings in shared dip bowls rather
 * than to leave any of them out: the vessel count is what gives, never the
 * ingredient list.
 *
 * ## The three clauses that answer real failures
 *
 * The first render of a real gathering page came back with the cucumber in two
 * bowls (raw spears and salted pieces), the vessels drawn as ellipses with
 * their outer walls showing, and a ground at #F6F2E1 against the style's
 * #FDFBF9 — the warm drift `generate-image` records as this model family's
 * signature. The shared style already forbids all three: `camera: "overhead"`
 * asks for "a true circle... nothing shows a side wall", and the background
 * rule pins the hex.
 *
 * The camera took two more passes and then went entirely — see above; the
 * whole overhead premise was wrong. What survives from those passes is the
 * VESSEL rule, which was worth the trip: the dishes had arrived as a matched
 * set of shallow plates with soy sauce lying in one, so they are now chosen by
 * what goes in them. **Naming the failure at the SUBJECT level is what a
 * general rule the model is quietly ignoring needs**, and these three bullets
 * are that and nothing more — they add no new art direction, they repeat the
 * style's own instruction in the terms the picture got wrong.
 *
 * ## No quantities, deliberately
 *
 * Only names are passed. Servings are adjustable in the app, so a picture drawn
 * around "two cucumbers" is wrong for everybody who changed the number — and a
 * gathering page is glanced at for WHAT is needed, which the recipe's own list
 * beneath it already quantifies.
 */
/** Which pictures a gathering-page render has attached, in the order sent. */
export type MiseReference = "gathering" | "hero";

/**
 * The gathering page's reference clause, which describes TWO pictures.
 *
 * The step prompt attaches one — the dish's own hero — and spends its force on
 * stopping the finished dish being copied. A gathering page attaches two, and
 * they answer different questions, so the clause has to say which is which or
 * the model averages them:
 *
 * - the GATHERING ANCHOR is a chosen render of another dish's gathering page.
 *   It carries what prose kept losing: the camera, the kind of vessels, how
 *   they are grouped and spaced. `style-anchors.ts` records the general lesson
 *   at length — prose loses to pictures, so the picture has to exist — and the
 *   camera is the exact thing that took three rounds to settle here.
 * - the HERO is this dish finished, attached for its INGREDIENTS' colour and
 *   gloss, which is what got the dressing onto the food on the step pictures.
 *
 * **Each is told what NOT to lend, and they are opposites.** The anchor lends
 * no food, because its ingredients belong to another recipe; the hero lends no
 * arrangement, because it is a plated dish and this is a bench before cooking.
 * Without that, the anchor's cucumber turns up in a salmon's mise — which is
 * `generateImage`'s subject-magnet warning with two magnets.
 *
 * **The order here must match the order they are SENT.** `generateImage` puts
 * reference images before the text in array order, so "the first" and "the
 * second" are claims about the payload rather than labels. The caller passes
 * the list it actually attached.
 */
const miseReferenceClause = (dish: string, refs: MiseReference[]) => {
    const anchor = refs.indexOf("gathering");
    const hero = refs.indexOf("hero");
    const ordinal = (i: number) =>
        refs.length === 1
            ? "The attached image"
            : i === 0
              ? "The FIRST"
              : "The SECOND";

    return [
        refs.length === 1
            ? "- ONE image is attached."
            : "- TWO images are attached, and they are for different things.",
        anchor >= 0 &&
            `${ordinal(anchor)} is ANOTHER DISH'S GATHERING PAGE. It is the standard for the CAMERA and its height, for the kind of vessels and how varied they are, for how they are grouped, spaced and overlapped, and for the medium, the palette, the ground, the light and the level of finish. Match all of that exactly. TAKE NONE OF ITS FOOD: its ingredients belong to a different recipe and not one of them appears here.`,
        hero >= 0 &&
            `${ordinal(hero)} is ${dish} itself, finished and plated — the dish this bench ends at. Take from it ONLY what this dish's own ingredients look like: their colour, their gloss, how wet or dry they are. Do not draw the finished dish, its plating, its vessel or its garnish; this is the moment before any cooking and nothing here is combined.`,
    ]
        .filter(Boolean)
        .join("\n");
};

export const buildMiseArtPrompt = (
    dish: string,
    ingredients: string[],
    options?: { references?: MiseReference[] },
): string =>
    `Editorial illustration of the ingredients for ${dish}, gathered and prepped before any cooking begins.

SUBJECT
- Every ingredient sits in its own small pale ceramic bowl or shallow dish, prepared the way the recipe needs it — whole, chopped, sliced, grated or measured out.
- The ingredients, and all of them are present: ${ingredients.join(", ")}.
- The small liquid seasonings SHARE little dip bowls rather than taking one each, so the picture settles at about seven to nine vessels in total rather than one per name. Group them; never leave one out.
- Nothing is combined, cooked, dressed or plated — this is the moment before the first instruction.
- The vessels are gathered in one loose cluster, rims close but not overlapping, none of them stacked.
- EACH INGREDIENT APPEARS EXACTLY ONCE. One ingredient never occupies two vessels, and the same ingredient is never shown twice in two states — not raw in one dish and prepared in another, not whole in one and cut in another. If a step of the method changes it, draw only its prepared state.
- The vessels are ARRANGED IN DEPTH, not in a flat row: some nearer the camera and some further back, overlapping slightly where they meet, so the group sits on a surface receding away from you rather than being laid out on a plan. Every one of them is seen at the SAME angle as every other.
- THE VESSELS ARE CHOSEN FOR WHAT IS IN THEM, the way a real bench is, and they are NOT a matched set: anything liquid, oily or wet — a sauce, an oil, a vinegar, a dressing, a paste — sits in a SMALL DEEP dipping bowl or ramekin with steep sides, never in a shallow plate it would run off. Fine dry things — salt, sugar, ground spice, seeds — take the smallest shallow dishes. Bulky prepared vegetables and anything in quantity take the widest, shallowest plate. Their sizes and depths differ noticeably from one another.
- The ground between and around the vessels is the FLAT PALE CREAM named below and nothing else. It must not warm toward yellow, beige, buff or ivory, and it is the same colour in the corners as it is between the bowls.
- This is ONE single continuous illustration of ONE arrangement, never a grid, a sequence, a panel or a labelled diagram. No text, no labels, no numbers anywhere in the image.
${
    options?.references?.length
        ? `${miseReferenceClause(dish, options.references)}
`
        : ""
}
${buildFoodIllustrationStyle({
    framing:
        "the cluster of vessels is centred and fills about two thirds of the frame, leaving a generous even margin of empty ground on all four sides. Nothing is cropped by an edge.",
    mood: "mise en place — everything prepped and waiting, before the cooking starts.",
})}`;
