/**
 * The art direction every Fridgeezy food illustration shares.
 *
 * This exists as one exported string because the two call sites — recipe hero
 * images and the home feed's cuisine tiles — render side by side in the app and
 * previously held two hand-maintained copies of the same paragraph. They drifted:
 * the recipe prompt lost the palette hex codes the cuisine one kept, and started
 * producing a green plate on marble for one dish and a speckled rustic bowl for
 * the next. Constants that must agree should not be prose in two files.
 *
 * Everything here is deliberately a *constant*, not a preference. Left to choose,
 * the model varies the vessel, surface, light and palette per dish, and any two
 * cards in the same feed stop looking like they came from one kitchen. The hex
 * codes are the client's own `COLORS` tokens; naming "soft peach" in words
 * instead of #F4A67A is what let the palette drift in the first place.
 *
 * The cost of spelling them out is that a hex code occasionally gets *drawn* —
 * one tiramisu render came back with "FDFBF9" lettered in the corner. Hence the
 * clause in the trailer saying the codes are instructions rather than subject
 * matter. Removing hex codes entirely would fix it too and is the wrong trade:
 * that is the drift this file exists to prevent.
 *
 * The palette is pinned to the vessel, ground and linework *only*. When it was
 * applied to the whole image the food inherited it — a tiramisu came back
 * garnished with peach shards.
 *
 * `Camera` is a slight tilt and NOT the overhead bird's-eye it was until
 * 2026-08-04. The history is worth keeping, because the overhead version looks
 * like the "correct" art-direction answer and is not the one that was chosen:
 *
 * Strict 90-degree overhead fought the recipe prompt's "build height and
 * layering" — a stacked dish (Cretan Dakos, pancakes, a tiramisu slice) cannot
 * show height from straight above, so the model quietly tilted to a
 * three-quarter view on exactly those dishes and stayed overhead on flat ones,
 * which read as random tilting. Forcing true overhead did fix it, verified 3/3
 * on each of the three offending dishes. It was then rejected on taste: shown a
 * ladder of 0/15/30/45 degrees across three dishes, 30 was picked, then 15 after
 * seeing 30 in the app. So the inconsistency was never the angle itself, it was
 * that the angle was *unstable*. Pinning it removes the conflict from the other
 * side, which is why the plating rule says nothing about viewpoint any more.
 *
 * The bowl sentence is not padding. At every angle tried, plated dishes took the
 * tilt and *bowls did not* — four bowl renders at 15 degrees came back flat
 * before it was added, against 7 of 8 plated dishes tilting correctly. A deep
 * bowl is the one vessel the model insists on drawing from straight above.
 *
 * A shallower angle needs more words than this one. At 15 degrees `cos 15°` is
 * 0.97, so the plate sits ~3% from a true circle, "slightly tilted" and "flat"
 * are neighbours, and the model rounded to a flat bird's-eye often; that setting
 * needed explicit visible consequences (a sliver of near inner wall, front faces
 * on the food) to be reproducible at all. 45 degrees is unambiguous enough not
 * to need them — but if this is ever dialled back down, expect to write them
 * again rather than just changing the number.
 *
 * Both call sites move together — this is a `FIXED STYLE` constant, and recipe
 * heroes and cuisine tiles sit on the same screen, so a hero at 30 degrees over
 * a tile at 90 would read as two different kitchens.
 *
 * `Tone` is the one rule that *does* cover the food, and it is worded to stay on
 * the safe side of that line: it constrains saturation and value (pale, chalky,
 * low contrast) and says nothing about hue. Rewriting it in terms of colours —
 * "wash everything in cream" — is the same mistake as widening the palette, and
 * produces the same peach-shard tiramisu. Linework is warm grey rather than the
 * app's near-black `black` token for the same reason: a #060606 outline is the
 * single element that pulls the image back out of the pastel range.
 */
export interface FoodIllustrationStyleOptions {
    /**
     * Whether the subject is served in a vessel at all.
     *
     * `"ceramic"` (the default) is the rule every plated surface shares. `"none"`
     * is for surfaces whose subject is raw ingredients rather than a finished
     * dish — the compose card's tiles, where a plate would be a smaller thing
     * inside a frame that wants filling.
     *
     * It swaps **two** lines, and they have to move together. Dropping the
     * vessel alone leaves `Background`'s "completely empty … no stray garnish
     * outside the vessel" governing a composition that has no vessel and no
     * visible ground, which reads to the model as an instruction to shrink the
     * subject back into the middle — the failure this option exists to avoid.
     * The negative half of that rule is what survives: no table, marble, wood,
     * cloth, cutlery or hands is what keeps these out of stock-photography
     * territory, and it holds whether or not a plate is present.
     *
     * Everything else — palette, the single upper-left light, tone, rendering —
     * is deliberately untouched. That is the whole point of doing this as an
     * option rather than a second style block: a tile and a hero on the same
     * screen still have to look like one kitchen.
     */
    vessel?: "ceramic" | "none";
    /**
     * Where the camera stands. `"three-quarter"` (the default) is the 45-degree
     * editorial angle every plated surface shares.
     *
     * `"overhead"` exists for one surface and one reason. The cuisine tiles show
     * several dishes at once in a 110pt square, and a table seen from 45 degrees
     * cannot be read at that size — the vessels occlude each other and the near
     * rims eat the frame. Measured over 24 renders on 2026-08-05: every
     * three-quarter arrangement of multiple dishes either centred itself in a
     * wide margin or lost its back row entirely.
     *
     * **This is the option the comment above warns about, and adopting it is a
     * real trade.** Recipe cards and cuisine tiles sit on the same home feed, so
     * a 45-degree hero now sits directly above a 90-degree tile. That was
     * accepted deliberately: at 110pt the tile reads as a pattern of colour
     * rather than as a photographed scene, and the two do not compete the way
     * two dish photographs would. If the tiles ever grow, revisit this — the
     * larger they get, the more they look like a different kitchen.
     */
    camera?: "three-quarter" | "overhead";
    /**
     * The colour the scene is painted on. Defaults to the app's `#FDFBF9`
     * ground, which is what every surface but one wants.
     *
     * The exception is the cuisine collection cards, where the illustration is
     * the lower half of a *tinted* card and has to sit on that tint rather than
     * in a cream rectangle inside it. There is no transparency in the pipeline —
     * the model returns an opaque PNG — so the only way to make the picture and
     * the card one surface is to paint the picture on the card's colour.
     *
     * Pass a token the client actually has (`primaryContainer`, `roseContainer`,
     * `secondaryContainer`), never a colour invented for an image: the card's
     * `backgroundColor` and this hex have to be the same paint, or the seam
     * shows exactly where the illustration ends.
     *
     * Both halves are needed. `Background` names the colour in words *and* in
     * hex, because naming it in words alone is what let the palette drift in the
     * first place; `Palette` pins the bare hex. Templating only one of the two
     * leaves them disagreeing.
     *
     * It rewrites the ground in both the `Background` and `Palette` lines. Only
     * changing one leaves the palette pinning a cream the background no longer
     * is, and the model splits the difference — a tinted scene with a cream
     * halo around the vessel.
     */
    ground?: { name: string; hex: string };
    /**
     * How the subject sits in the frame. The one genuinely per-surface rule: a
     * 3:4 recipe hero is centre-cropped three ways by the client and needs an
     * even margin to survive, while a small cuisine tile is cropped hard enough
     * that a floating, generously-margined plate leaves mostly background.
     */
    framing: string;
    /** One line, appended after the style block. */
    mood: string;
    /**
     * An extra sentence inside the Rendering line, between the positive
     * description and the closing "not photorealistic…" clause. Per-surface
     * because the two surfaces want opposite things: a recipe hero concentrates
     * detail on the centrepiece so the eye lands in one place, while a cuisine
     * tile is 110px tall and needs its detail spread evenly to read at all.
     *
     * It sits mid-line rather than appended because that is where it was when
     * the blind A/B was run, and the negative clause has to stay last.
     */
    renderingEmphasis?: string;
}

/**
 * Emits the style block, the mood line and the no-text constraint in that
 * order. The trailer is part of the builder rather than something call sites
 * append because the negative constraint has to stay the *last* thing in the
 * prompt — that is the ordering the A/B rounds were run against, and the run
 * that framed an image had no such line at all.
 */
/**
 * The vessel and ground rules. Two records rather than one string because the
 * lines they replace are not adjacent — `Framing` sits between them, and this
 * prompt's line order is what the 2026-08-04 A/B rounds were run against.
 * Chosen as a pair all the same; see `vessel` for why neither moves alone.
 */
type VesselMode = NonNullable<FoodIllustrationStyleOptions["vessel"]>;

const VESSEL_RULE: Record<VesselMode, string> = {
    ceramic: `- Vessel: matte handmade ceramic in creamy off-white (#FFF5EE) with subtle artisanal texture and a slightly irregular hand-thrown rim. Its shape follows the dish (flat plate, shallow bowl, deep bowl); its material and colour never change. Use plain clear glassware only for drinks and layered desserts.`,
    none: `- Vessel: none. There is no plate, bowl, board, tray, glass, pan or dish of any kind anywhere in the image, and no surface for one to stand on. The ingredients are the whole subject and are shown as themselves.`,
};

/** Where the camera stands — see `camera`, and the trade it carries. */
type CameraMode = NonNullable<FoodIllustrationStyleOptions["camera"]>;

const CAMERA_RULE: Record<CameraMode, string> = {
    "three-quarter": `- Camera: the classic editorial three-quarter angle — about 45 degrees — looking down and across at the dish. A round plate reads as a pronounced ellipse, the vessel's near rim and outer side wall are clearly visible, and the food shows its full height and its own front faces. Never a flat top-down view, and never so low that it becomes side-on or eye-level: you are still looking distinctly downward into the dish. This applies to bowls exactly as much as to flat plates — a bowl is not an excuse to look straight down. A bowl is seen at the same angle, so its rim is a wide ellipse and a band of its far inner wall stays visible behind the food.`,
    overhead: `- Camera: perfectly overhead bird's-eye, 90 degrees, straight down. No perspective tilt at all: a round vessel reads as a true circle, a rectangular one as a true rectangle, and nothing shows a side wall or a front face. Every vessel lies flat to the picture plane.`,
};

/**
 * A function of the ground, not a constant table, because the colour varies per
 * surface. `VESSEL_RULE` above stays a table: it names no colour that moves.
 */
const backgroundRule = (
    vessel: VesselMode,
    ground: { name: string; hex: string }
) =>
    vessel === "ceramic"
        ? `- Background: flat, lightly textured ${ground.name} (${ground.hex}), completely empty. No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel. No borders, frames or inset panels — the background runs to all four edges of the image.`
        : `- Background: no table surface, marble, wood grain, cloth, cutlery, napkins or hands, ever. Wherever the subject does not reach, the ground is flat, lightly textured ${ground.name} (${ground.hex}) — but the subject is expected to cover the frame, so little or none of it may show. No borders, frames or inset panels — the image runs to all four edges.`;

export const buildFoodIllustrationStyle = ({
    vessel = "ceramic",
    camera = "three-quarter",
    ground = { name: "warm cream", hex: "#FDFBF9" },
    framing,
    mood,
    renderingEmphasis,
}: FoodIllustrationStyleOptions): string =>
    `FIXED STYLE — identical in every image
${CAMERA_RULE[camera]}
${VESSEL_RULE[vessel]}
- Framing: ${framing}
${backgroundRule(vessel, ground)}
- Light: soft diffuse studio daylight from the upper left, casting exactly one gentle, soft-edged, low-contrast shadow from the ${vessel === "none" ? "subject" : "vessel"} toward the lower right. No other shadows anywhere — no dappled light, no foliage or window patterns, no shadows from objects outside the frame. No hard specular highlights.
- Palette: the vessel, background and linework are fixed — cream #FFF5EE, warm stone #FAF8F6, ground ${ground.hex}, with warm grey #5C5450 only as sparse, fine linework — never a near-black outline; peach #F4A67A and sage green #93C5A8 are the accent tones. The food keeps its own true hues, rendered in the same warm register. No saturated primaries, no neon, no pure black.
- Tone: high-key, pastel and softly washed throughout. Every value sits in the upper, lighter half of the range, as if a thin veil of warm cream were laid over the whole image — colours are chalky, faded and gently muted rather than rich, punchy or glossy. Even the darkest element stays a soft warm mid-tone; contrast between light and dark is low and edges between colours are soft. This is a treatment of saturation and value only: it must never change *which* colour a food is, only how pale and quiet it reads.
- Rendering: refined modern editorial illustration — delicate hand-drawn linework, gentle gouache and watercolour-like washes with soft, slightly bleeding edges, clean flat-leaning shapes; minimal, airy and warm.${renderingEmphasis ? ` ${renderingEmphasis}` : ""} Not photorealistic, not 3D-rendered, not cartoonish, not high-contrast.

Mood: ${mood}

Render the illustration only. No text, letters, numbers, labels, logos, watermarks, borders or frames. The hex colour codes above are instructions to you, not things to depict — never write, print or paint a colour code, caption or swatch anywhere in the picture.`;
